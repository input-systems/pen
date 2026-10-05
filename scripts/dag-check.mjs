#!/usr/bin/env node
/**
 * API1 dependency DAG check (spec/rules/api.md).
 *
 * Target install DAG (arrow means "depends on"):
 *   types ← yjs ← core ← {extensions, shared, schema, transport}
 *   core ← dom ← {react, vue}
 *   the starter package ← everything it assembles
 *
 * Inverted edges fail unless listed in scripts/dag-allowlist.json with a reason.
 * Known inversions are printed. Inversions themselves are deferred; this script
 * only reports them.
 *
 * Checks the published package.json install graph (dependencies + required
 * @input/pen-* peers). Tooling, docs, and playground are outside the product DAG.
 *
 * Two graphs, two properties. The inversion check above runs on the *install*
 * graph, which excludes devDependencies because they do not ship. Turbo orders
 * tasks on a wider graph that does include them, and it refuses to run at all
 * if that graph has a cycle. So this script also walks the *task* graph for
 * cycles, over every workspace package including private and tooling ones.
 *
 * Keeping them separate matters: an extension taking a devDependency on a
 * tooling package is not a layering inversion and must not be reported as one,
 * but it can still close a loop back through core and stop the whole build.
 * That is exactly what happened on 2026-08-21 while this check did not exist.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	collectPackageJsonPaths,
	loadPublishedManifests,
} from "./lib/workspacePackages.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_ALLOWLIST = path.join("scripts", "dag-allowlist.json");

const WORKSPACE_SCOPE = "@input/pen-";

const LAYER_RANK = {
	types: 0,
	crdt: 1,
	core: 2,
	feature: 3,
	dom: 4,
	binding: 5,
	preset: 6,
};

export function layerForPackageDir(relPosix) {
	const parts = relPosix.split("/").filter(Boolean);
	if (parts[0] !== "packages" || parts.length < 2) {
		return null;
	}

	const slot = parts[1];
	if (parts.length === 2) {
		if (slot === "types") {
			return "types";
		}
		if (slot === "core") {
			return "core";
		}
		if (slot === "docs") {
			return "ignore";
		}
		if (slot === "pen") {
			return "preset";
		}
		if (slot === "schema" || slot === "transport") {
			return "feature";
		}
		return null;
	}

	if (parts.length !== 3) {
		return null;
	}

	const name = parts[2];
	if (slot === "crdt") {
		return "crdt";
	}
	if (slot === "extensions" || slot === "shared") {
		return "feature";
	}
	if (slot === "tooling") {
		return "ignore";
	}
	if (slot === "rendering") {
		if (name === "dom") {
			return "dom";
		}
		if (name === "react" || name === "vue") {
			return "binding";
		}
	}
	return null;
}

export function workspaceDependencyNames(packageJson) {
	const names = new Set();
	collectScopedDeps(names, packageJson.dependencies);
	const optionalPeers = new Set(
		Object.entries(packageJson.peerDependenciesMeta ?? {})
			.filter(([, meta]) => meta?.optional === true)
			.map(([name]) => name),
	);
	for (const name of Object.keys(packageJson.peerDependencies ?? {})) {
		if (name.startsWith(WORKSPACE_SCOPE) && !optionalPeers.has(name)) {
			names.add(name);
		}
	}
	return [...names].sort();
}

function collectScopedDeps(names, deps) {
	for (const name of Object.keys(deps ?? {})) {
		if (name.startsWith(WORKSPACE_SCOPE)) {
			names.add(name);
		}
	}
}

export function taskGraphDependencyNames(packageJson) {
	const names = new Set();
	collectScopedDeps(names, packageJson.dependencies);
	collectScopedDeps(names, packageJson.devDependencies);
	collectScopedDeps(names, packageJson.optionalDependencies);
	collectScopedDeps(names, packageJson.peerDependencies);
	return [...names].sort();
}

/**
 * Returns the first cycle as the package path around the loop, ending with the
 * package it re-enters, or null when the graph is acyclic. The path is the only
 * form of this failure a human can act on — "there is a cycle" is not enough to
 * find the edge that introduced it.
 */
export function findCycle({ packages }) {
	const edges = new Map(
		packages.map((pkg) => [pkg.name, pkg.dependencies ?? []]),
	);
	const state = new Map();
	const stack = [];

	function visit(name) {
		const status = state.get(name);
		if (status === "done") {
			return null;
		}
		if (status === "active") {
			return [...stack.slice(stack.indexOf(name)), name];
		}

		state.set(name, "active");
		stack.push(name);
		for (const dep of edges.get(name) ?? []) {
			if (!edges.has(dep)) {
				continue;
			}
			const cycle = visit(dep);
			if (cycle != null) {
				return cycle;
			}
		}
		stack.pop();
		state.set(name, "done");
		return null;
	}

	for (const name of [...edges.keys()].sort()) {
		const cycle = visit(name);
		if (cycle != null) {
			return cycle;
		}
	}
	return null;
}

export function parseAllowlist(raw) {
	const inversions = raw?.inversions;
	if (!Array.isArray(inversions)) {
		throw new Error("dag-allowlist.json must have an inversions array");
	}
	return inversions.map((entry, index) => {
		if (
			typeof entry?.from !== "string" ||
			typeof entry?.to !== "string" ||
			typeof entry?.reason !== "string" ||
			entry.from.length === 0 ||
			entry.to.length === 0 ||
			entry.reason.trim().length === 0
		) {
			throw new Error(
				`dag-allowlist.json inversions[${index}] needs from, to, and a non-empty reason`,
			);
		}
		return { from: entry.from, to: entry.to, reason: entry.reason.trim() };
	});
}

export function evaluateInversions({ packages, allowlist }) {
	const byName = new Map();
	const unclassified = [];

	for (const pkg of packages) {
		const layer = pkg.layer ?? layerForPackageDir(pkg.dir);
		if (layer == null) {
			unclassified.push(pkg.dir ?? pkg.name);
			continue;
		}
		byName.set(pkg.name, { ...pkg, layer });
	}

	const inverted = [];
	for (const pkg of byName.values()) {
		if (!(pkg.layer in LAYER_RANK)) {
			continue;
		}
		for (const depName of pkg.dependencies) {
			const dep = byName.get(depName);
			if (dep == null || !(dep.layer in LAYER_RANK)) {
				continue;
			}
			if (LAYER_RANK[pkg.layer] < LAYER_RANK[dep.layer]) {
				inverted.push({
					from: pkg.name,
					to: depName,
					fromLayer: pkg.layer,
					toLayer: dep.layer,
				});
			}
		}
	}

	inverted.sort(compareEdge);
	const allowlistByKey = new Map(
		allowlist.map((entry) => [edgeKey(entry), entry]),
	);
	const invertedKeys = new Set(inverted.map(edgeKey));

	const unexpected = inverted.filter(
		(edge) => !allowlistByKey.has(edgeKey(edge)),
	);
	const allowed = inverted
		.filter((edge) => allowlistByKey.has(edgeKey(edge)))
		.map((edge) => ({
			...edge,
			reason: allowlistByKey.get(edgeKey(edge)).reason,
		}));
	const stale = allowlist.filter(
		(entry) => !invertedKeys.has(edgeKey(entry)),
	);

	return { inverted, allowed, unexpected, stale, unclassified };
}

function edgeKey(edge) {
	return `${edge.from}\0${edge.to}`;
}

function compareEdge(left, right) {
	return (
		left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
	);
}

export function formatReport(result) {
	const lines = ["API1 dependency DAG"];

	if (result.unclassified.length > 0) {
		lines.push("");
		lines.push(
			"FAIL unclassified published packages (assign a DAG layer):",
		);
		for (const dir of result.unclassified) {
			lines.push(`  ${dir}`);
		}
	}

	lines.push("");
	if (result.allowed.length === 0) {
		lines.push("Allowlisted inversions: none");
	} else {
		lines.push(
			"Allowlisted inversions (expected until P.1 inversions land):",
		);
		for (const edge of result.allowed) {
			lines.push(
				`  ${edge.from} → ${edge.to}  (${edge.fromLayer} → ${edge.toLayer})`,
			);
			lines.push(`    ${edge.reason}`);
		}
	}

	if (result.unexpected.length > 0) {
		lines.push("");
		lines.push("FAIL unexpected inverted edges:");
		for (const edge of result.unexpected) {
			lines.push(
				`  ${edge.from} → ${edge.to}  (${edge.fromLayer} → ${edge.toLayer})`,
			);
		}
	}

	if (result.stale.length > 0) {
		lines.push("");
		lines.push(
			"FAIL stale allowlist entries (no longer inverted; remove them):",
		);
		for (const entry of result.stale) {
			lines.push(`  ${entry.from} → ${entry.to}`);
			lines.push(`    ${entry.reason}`);
		}
	}

	if (
		result.unexpected.length === 0 &&
		result.stale.length === 0 &&
		result.unclassified.length === 0
	) {
		lines.push("");
		lines.push(
			`OK: ${result.allowed.length} allowlisted inversion(s); allowlist matches the install graph.`,
		);
	}

	return lines.join("\n");
}

export function runSelfTests() {
	const types = fixturePkg("packages/types", "@input/pen-types", []);
	const crdt = fixturePkg("packages/crdt/yjs", "@input/pen-yjs", [
		"@input/pen-types",
	]);
	const core = fixturePkg("packages/core", "@input/pen-core", [
		"@input/pen-types",
		"@input/pen-yjs",
		"@input/pen-delta-stream",
	]);
	const deltaStream = fixturePkg(
		"packages/extensions/delta-stream",
		"@input/pen-delta-stream",
		["@input/pen-types"],
	);
	const react = fixturePkg("packages/rendering/react", "@input/pen-react", [
		"@input/pen-core",
		"@input/pen-dom",
	]);
	const dom = fixturePkg("packages/rendering/dom", "@input/pen-dom", [
		"@input/pen-core",
	]);
	const widget = fixturePkg(
		"packages/extensions/widget",
		"@input/pen-widget",
		["@input/pen-core", "@input/pen-react"],
	);

	const allowlist = [
		{
			from: "@input/pen-core",
			to: "@input/pen-delta-stream",
			reason: "fixture",
		},
	];

	const matching = evaluateInversions({
		packages: [types, crdt, core, deltaStream, react, dom],
		allowlist,
	});
	assert(
		matching.unexpected.length === 0,
		"self-test: matching allowlist must not fail",
	);
	assert(
		matching.stale.length === 0,
		"self-test: matching allowlist must not be stale",
	);
	assert(
		matching.allowed.length === 1,
		"self-test: expected one allowlisted inversion",
	);
	assert(
		matching.allowed[0].from === "@input/pen-core" &&
			matching.allowed[0].to === "@input/pen-delta-stream",
		"self-test: allowlisted edge should be core → delta-stream",
	);

	const fake = evaluateInversions({
		packages: [
			types,
			crdt,
			{
				...core,
				dependencies: [...core.dependencies, "@input/pen-react"],
			},
			deltaStream,
			react,
			dom,
		],
		allowlist,
	});
	assert(
		fake.unexpected.some(
			(edge) =>
				edge.from === "@input/pen-core" &&
				edge.to === "@input/pen-react",
		),
		"self-test: fake inverted edge not on the allowlist must fail",
	);

	const extensionToRenderer = evaluateInversions({
		packages: [types, crdt, core, deltaStream, react, dom, widget],
		allowlist,
	});
	assert(
		extensionToRenderer.unexpected.some(
			(edge) =>
				edge.from === "@input/pen-widget" &&
				edge.to === "@input/pen-react",
		),
		"self-test: extension → rendering must be inverted",
	);

	const stale = evaluateInversions({
		packages: [
			types,
			crdt,
			{
				...core,
				dependencies: ["@input/pen-types", "@input/pen-yjs"],
			},
			deltaStream,
		],
		allowlist,
	});
	assert(
		stale.stale.length === 1,
		"self-test: missing allowlisted edge must be stale",
	);

	const downward = evaluateInversions({
		packages: [
			types,
			crdt,
			{
				...core,
				dependencies: ["@input/pen-types", "@input/pen-yjs"],
			},
			dom,
			react,
		],
		allowlist: [],
	});
	assert(
		downward.inverted.length === 0,
		"self-test: downward edges are not inversions",
	);

	assert(
		findCycle({
			packages: [types, crdt, core, deltaStream, react, dom],
		}) === null,
		"self-test: acyclic graph must report no cycle",
	);

	// The real 2026-08-21 break, reduced: undo devDepends on pen-test, pen-test
	// reaches core, and core devDepends on undo. No edge here is a layering
	// inversion, which is why the inversion check cannot see it.
	const cycle = findCycle({
		packages: [
			fixturePkg("packages/core", "@input/pen-core", ["@input/pen-undo"]),
			fixturePkg("packages/extensions/undo", "@input/pen-undo", [
				"@input/pen-test",
			]),
			fixturePkg("packages/tooling/test", "@input/pen-test", [
				"@input/pen-core",
			]),
		],
	});
	assert(cycle != null, "self-test: devDependency cycle must be detected");
	assert(
		cycle[0] === cycle[cycle.length - 1],
		"self-test: cycle path must close on the package it re-enters",
	);
	assert(
		cycle.includes("@input/pen-undo") && cycle.includes("@input/pen-test"),
		"self-test: cycle path must name the packages in the loop",
	);
	assert(
		evaluateInversions({
			packages: [
				fixturePkg("packages/extensions/undo", "@input/pen-undo", [
					"@input/pen-test",
				]),
				fixturePkg("packages/tooling/test", "@input/pen-test", []),
			],
			allowlist: [],
		}).unexpected.length === 0,
		"self-test: extension → tooling is not an inversion, so only the cycle check can catch it",
	);

	assert(
		taskGraphDependencyNames({
			dependencies: { "@input/pen-types": "workspace:^" },
			devDependencies: { "@input/pen-test": "workspace:*", vitest: "^3" },
		}).join(",") === "@input/pen-test,@input/pen-types",
		"self-test: task graph counts devDependencies, install graph does not",
	);

	assert(
		layerForPackageDir("packages/extensions/undo") === "feature",
		"self-test: extension layer",
	);
	assert(
		layerForPackageDir("packages/rendering/vue") === "binding",
		"self-test: vue layer",
	);
	assert(
		layerForPackageDir("packages/tooling/bench") === "ignore",
		"self-test: tooling ignored",
	);
	assert(
		layerForPackageDir("packages/pen") === "preset",
		"self-test: starter package layer",
	);
	assert(
		layerForPackageDir("packages/schema") === "feature" &&
			layerForPackageDir("packages/transport") === "feature",
		"self-test: two-segment schema and transport layers",
	);
	assert(
		workspaceDependencyNames({
			dependencies: { "@input/pen-core": "workspace:*", react: "^19" },
			peerDependencies: {
				"@input/pen-import-html": "workspace:*",
				"@input/pen-types": "workspace:*",
			},
			peerDependenciesMeta: {
				"@input/pen-import-html": { optional: true },
			},
		}).join(",") === "@input/pen-core,@input/pen-types",
		"self-test: optional peers are not install-graph edges",
	);
}

function fixturePkg(dir, name, dependencies) {
	return { dir, name, dependencies };
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

export async function loadWorkspacePackages(repoRoot) {
	const manifests = await loadPublishedManifests(repoRoot);
	return manifests.map(({ name, dir, packageJson }) => ({
		name,
		dir,
		dependencies: workspaceDependencyNames(packageJson),
	}));
}

/**
 * Every workspace package, private and tooling included, with devDependencies
 * counted. This is the graph turbo orders tasks on, not the graph that ships.
 */
export async function loadTaskGraphPackages(repoRoot) {
	const packagesRoot = path.join(repoRoot, "packages");
	const packageJsonPaths = await collectPackageJsonPaths(packagesRoot);
	const packages = [];

	for (const packageJsonPath of packageJsonPaths) {
		const packageJson = JSON.parse(
			await fs.readFile(packageJsonPath, "utf8"),
		);
		if (typeof packageJson.name !== "string") {
			continue;
		}
		packages.push({
			name: packageJson.name,
			dependencies: taskGraphDependencyNames(packageJson),
		});
	}

	packages.sort((left, right) => left.name.localeCompare(right.name));
	return packages;
}

export async function loadAllowlist(
	repoRoot,
	allowlistRel = DEFAULT_ALLOWLIST,
) {
	const text = await fs.readFile(path.join(repoRoot, allowlistRel), "utf8");
	return parseAllowlist(JSON.parse(text));
}

function parseArgs(argv) {
	let repoRoot = DEFAULT_REPO_ROOT;
	let selfTestOnly = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--self-test") {
			selfTestOnly = true;
			continue;
		}
		if (arg === "--repo-root") {
			repoRoot = path.resolve(argv[i + 1] ?? "");
			i += 1;
			continue;
		}
		throw new Error(`Unknown flag: ${arg}`);
	}
	return { repoRoot, selfTestOnly };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	runSelfTests();
	console.log(
		"API1 DAG self-test ok (fixture object; fake inverted edge fails closed; devDependency cycle detected)",
	);
	if (args.selfTestOnly) {
		return;
	}

	const taskGraph = await loadTaskGraphPackages(args.repoRoot);
	if (taskGraph.length === 0) {
		console.error(
			"dag-check: cannot check: packages/**/package.json walk matched 0 files",
		);
		process.exitCode = 1;
		return;
	}
	const cycle = findCycle({ packages: taskGraph });
	console.log("");
	console.log(
		`population: ${taskGraph.length} workspace packages (packages/**/package.json, private included)`,
	);
	console.log(
		`Task graph: ${taskGraph.length} workspace packages (devDependencies counted)`,
	);
	if (cycle == null) {
		console.log("No dependency cycles.");
	} else {
		console.log("");
		console.log("FAIL dependency cycle (turbo cannot build this graph):");
		console.log(`  ${cycle.join("\n    → ")}`);
	}

	const packages = await loadWorkspacePackages(args.repoRoot);
	const allowlist = await loadAllowlist(args.repoRoot);
	const result = evaluateInversions({ packages, allowlist });
	console.log("");
	console.log(formatReport(result));
	if (
		cycle != null ||
		result.unexpected.length > 0 ||
		result.stale.length > 0 ||
		result.unclassified.length > 0
	) {
		process.exitCode = 1;
	}
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
