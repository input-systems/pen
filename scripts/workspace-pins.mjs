#!/usr/bin/env node
/**
 * API7 manifest pin / artifact check (spec/rules/api.md).
 *
 * Reports, on published packages:
 *   - workspace:* vs workspace:^ in dependencies and peerDependencies
 *   - ESM artifact extension: dist/index.js vs dist/index.mjs
 *   - sideEffects !== false
 *
 * workspace:* and dist/index.js hits fail unless listed in
 * scripts/workspace-pins-allowlist.json with a reason. Published packages
 * use workspace:^ and dist/index.mjs; the allowlist is empty so a new
 * unmarked pin or .js artifact fails. This script does not rewrite
 * package.json — sync-package-metadata.mjs owns the rewrite.
 *
 * Checks the published package.json set (private packages skipped).
 * Tooling husks marked private, docs, playground, and examples are out of scope.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublishedManifests } from "./lib/workspacePackages.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_ALLOWLIST = path.join("scripts", "workspace-pins-allowlist.json");

const WORKSPACE_PROTOCOL = "workspace:";
const DESIRED_PIN = "workspace:^";
const STAR_PIN = "workspace:*";
const PIN_FIELDS = ["dependencies", "peerDependencies"];
const JS_INDEX = "/dist/index.js";
const MJS_INDEX = "/dist/index.mjs";

const PIN_REASON_RE =
	/P\.8|F34|E\.4|conversion deferred|workspace:\*|exact version/i;
const JS_REASON_RE = /P\.8|F34|index\.js|\.mjs|conversion deferred/i;

export function collectWorkspacePins(packageJson) {
	const pins = [];
	for (const field of PIN_FIELDS) {
		for (const [dependency, spec] of Object.entries(
			packageJson[field] ?? {},
		)) {
			if (typeof spec !== "string" || !spec.startsWith(WORKSPACE_PROTOCOL)) {
				continue;
			}
			pins.push({ field, dependency, spec });
		}
	}
	pins.sort(comparePin);
	return pins;
}

export function esmArtifactPath(packageJson) {
	const importDefault = packageJson.exports?.["."]?.import?.default;
	if (typeof importDefault === "string") {
		return importDefault;
	}
	if (typeof packageJson.exports?.["."]?.import === "string") {
		return packageJson.exports["."].import;
	}
	if (typeof packageJson.module === "string") {
		return packageJson.module;
	}
	return null;
}

export function isJsIndexArtifact(artifactPath) {
	return (
		typeof artifactPath === "string" &&
		artifactPath.endsWith(JS_INDEX) &&
		!artifactPath.endsWith(MJS_INDEX)
	);
}

export function isMjsIndexArtifact(artifactPath) {
	return typeof artifactPath === "string" && artifactPath.endsWith(MJS_INDEX);
}

export function parseAllowlist(raw) {
	const workspaceStar = raw?.workspaceStar;
	const jsArtifacts = raw?.jsArtifacts ?? [];
	if (!Array.isArray(workspaceStar)) {
		throw new Error(
			"workspace-pins-allowlist.json must have a workspaceStar array",
		);
	}
	if (!Array.isArray(jsArtifacts)) {
		throw new Error(
			"workspace-pins-allowlist.json jsArtifacts must be an array",
		);
	}

	const pins = workspaceStar.map((entry, index) => {
		if (
			typeof entry?.package !== "string" ||
			typeof entry?.field !== "string" ||
			typeof entry?.dependency !== "string" ||
			typeof entry?.reason !== "string" ||
			entry.package.length === 0 ||
			entry.dependency.length === 0 ||
			!PIN_FIELDS.includes(entry.field) ||
			entry.reason.trim().length === 0
		) {
			throw new Error(
				`workspace-pins-allowlist.json workspaceStar[${index}] needs package, field (${PIN_FIELDS.join(" | ")}), dependency, and a non-empty reason`,
			);
		}
		if (!PIN_REASON_RE.test(entry.reason)) {
			throw new Error(
				`workspace-pins-allowlist.json workspaceStar[${index}] reason must name P.8 / F34 / the conversion deferral`,
			);
		}
		return {
			package: entry.package,
			field: entry.field,
			dependency: entry.dependency,
			reason: entry.reason.trim(),
		};
	});

	const artifacts = jsArtifacts.map((entry, index) => {
		if (
			typeof entry?.package !== "string" ||
			typeof entry?.reason !== "string" ||
			entry.package.length === 0 ||
			entry.reason.trim().length === 0
		) {
			throw new Error(
				`workspace-pins-allowlist.json jsArtifacts[${index}] needs package and a non-empty reason`,
			);
		}
		if (!JS_REASON_RE.test(entry.reason)) {
			throw new Error(
				`workspace-pins-allowlist.json jsArtifacts[${index}] reason must name P.8 / F34 / the .js vs .mjs deferral`,
			);
		}
		return {
			package: entry.package,
			reason: entry.reason.trim(),
		};
	});

	return { workspaceStar: pins, jsArtifacts: artifacts };
}

export function evaluatePins({ packages, allowlist }) {
	const starHits = [];
	const caretPins = [];
	const otherPins = [];
	const jsHits = [];
	const mjsPackages = [];
	const sideEffectsHits = [];

	for (const pkg of packages) {
		for (const pin of pkg.pins ?? collectWorkspacePins(pkg.packageJson ?? {})) {
			const hit = {
				package: pkg.name,
				field: pin.field,
				dependency: pin.dependency,
				spec: pin.spec,
			};
			if (pin.spec === STAR_PIN) {
				starHits.push(hit);
			} else if (pin.spec === DESIRED_PIN) {
				caretPins.push(hit);
			} else {
				otherPins.push(hit);
			}
		}

		const artifact =
			pkg.esmArtifact !== undefined
				? pkg.esmArtifact
				: esmArtifactPath(pkg.packageJson ?? {});
		if (isJsIndexArtifact(artifact)) {
			jsHits.push({ package: pkg.name, artifact });
		} else if (isMjsIndexArtifact(artifact)) {
			mjsPackages.push(pkg.name);
		}

		const sideEffects =
			pkg.sideEffects !== undefined
				? pkg.sideEffects
				: pkg.packageJson?.sideEffects;
		if (sideEffects !== false) {
			sideEffectsHits.push({
				package: pkg.name,
				sideEffects: sideEffects ?? null,
			});
		}
	}

	starHits.sort(compareStar);
	caretPins.sort(compareStar);
	otherPins.sort(compareStar);
	jsHits.sort((left, right) => left.package.localeCompare(right.package));
	mjsPackages.sort();
	sideEffectsHits.sort((left, right) =>
		left.package.localeCompare(right.package),
	);

	const pinAllowByKey = new Map(
		allowlist.workspaceStar.map((entry) => [pinKey(entry), entry]),
	);
	const jsAllowByName = new Map(
		allowlist.jsArtifacts.map((entry) => [entry.package, entry]),
	);
	const starKeys = new Set(starHits.map(pinKey));
	const jsNames = new Set(jsHits.map((hit) => hit.package));

	const unexpectedPins = [
		...starHits.filter((hit) => !pinAllowByKey.has(pinKey(hit))),
		...otherPins,
	];
	const allowedPins = starHits
		.filter((hit) => pinAllowByKey.has(pinKey(hit)))
		.map((hit) => ({
			...hit,
			reason: pinAllowByKey.get(pinKey(hit)).reason,
		}));
	const stalePins = allowlist.workspaceStar.filter(
		(entry) => !starKeys.has(pinKey(entry)),
	);

	const unexpectedJs = jsHits.filter((hit) => !jsAllowByName.has(hit.package));
	const allowedJs = jsHits
		.filter((hit) => jsAllowByName.has(hit.package))
		.map((hit) => ({
			...hit,
			reason: jsAllowByName.get(hit.package).reason,
		}));
	const staleJs = allowlist.jsArtifacts.filter(
		(entry) => !jsNames.has(entry.package),
	);

	return {
		starHits,
		caretPins,
		otherPins,
		jsHits,
		mjsPackages,
		sideEffectsHits,
		allowedPins,
		unexpectedPins,
		stalePins,
		allowedJs,
		unexpectedJs,
		staleJs,
	};
}

export function formatReport(result) {
	const lines = ["API7 manifest uniformity (P.8)"];
	lines.push("");
	lines.push(
		`workspace:*  ${result.starHits.length}  (allowlisted ${result.allowedPins.length})`,
	);
	lines.push(`workspace:^  ${result.caretPins.length}`);
	if (result.otherPins.length > 0) {
		lines.push(`workspace:?  ${result.otherPins.length}`);
	}
	lines.push(
		`dist/index.js   ${result.jsHits.length}  (allowlisted ${result.allowedJs.length})`,
	);
	lines.push(`dist/index.mjs  ${result.mjsPackages.length}`);
	lines.push(
		`sideEffects !== false  ${result.sideEffectsHits.length}`,
	);

	if (result.caretPins.length > 0) {
		lines.push("");
		lines.push("workspace:^ (desired pin style):");
		for (const pin of result.caretPins) {
			lines.push(
				`  ${pin.package} ${pin.field} ${pin.dependency}`,
			);
		}
	}

	if (result.allowedJs.length > 0) {
		lines.push("");
		lines.push(
			"Allowlisted dist/index.js exporters (expected until P.8 conversion):",
		);
		for (const hit of result.allowedJs) {
			lines.push(`  ${hit.package}  ${hit.artifact}`);
		}
	}

	lines.push("");
	if (result.sideEffectsHits.length === 0) {
		lines.push("sideEffects: all published packages declare false.");
	} else {
		lines.push("sideEffects !== false:");
		for (const hit of result.sideEffectsHits) {
			lines.push(
				`  ${hit.package}  ${JSON.stringify(hit.sideEffects)}`,
			);
		}
	}

	if (result.unexpectedPins.length > 0) {
		lines.push("");
		lines.push("FAIL unexpected workspace pin(s) (not on the allowlist):");
		for (const pin of result.unexpectedPins) {
			lines.push(
				`  ${pin.package} ${pin.field} ${pin.dependency}  ${pin.spec}`,
			);
		}
	}

	if (result.stalePins.length > 0) {
		lines.push("");
		lines.push(
			"FAIL stale workspace:* allowlist entries (converted or removed; drop them):",
		);
		for (const entry of result.stalePins) {
			lines.push(
				`  ${entry.package} ${entry.field} ${entry.dependency}`,
			);
			lines.push(`    ${entry.reason}`);
		}
	}

	if (result.unexpectedJs.length > 0) {
		lines.push("");
		lines.push(
			"FAIL unexpected dist/index.js exporter(s) (not on the allowlist):",
		);
		for (const hit of result.unexpectedJs) {
			lines.push(`  ${hit.package}  ${hit.artifact}`);
		}
	}

	if (result.staleJs.length > 0) {
		lines.push("");
		lines.push(
			"FAIL stale jsArtifacts allowlist entries (now .mjs or gone; drop them):",
		);
		for (const entry of result.staleJs) {
			lines.push(`  ${entry.package}`);
			lines.push(`    ${entry.reason}`);
		}
	}

	if (!hasFailures(result)) {
		lines.push("");
		lines.push(
			`OK: allowlist matches today's tree (${result.allowedPins.length} workspace:*; ${result.allowedJs.length} dist/index.js).`,
		);
	}

	return lines.join("\n");
}

export function hasFailures(result) {
	return (
		result.unexpectedPins.length > 0 ||
		result.stalePins.length > 0 ||
		result.unexpectedJs.length > 0 ||
		result.staleJs.length > 0 ||
		result.sideEffectsHits.length > 0
	);
}

export function runSelfTests() {
	const core = fixturePkg({
		name: "@input/pen-core",
		pins: [
			{
				field: "dependencies",
				dependency: "@input/pen-types",
				spec: STAR_PIN,
			},
			{
				field: "dependencies",
				dependency: "@input/pen-schema",
				spec: DESIRED_PIN,
			},
		],
		esmArtifact: "./dist/index.mjs",
		sideEffects: false,
	});
	const history = fixturePkg({
		name: "@input/pen-snapshots",
		pins: [
			{
				field: "dependencies",
				dependency: "@input/pen-types",
				spec: STAR_PIN,
			},
		],
		esmArtifact: "./dist/index.js",
		sideEffects: false,
	});
	const allowlist = {
		workspaceStar: [
			{
				package: "@input/pen-core",
				field: "dependencies",
				dependency: "@input/pen-types",
				reason: "P.8 conversion deferred — workspace:* packs to an exact version (F34).",
			},
			{
				package: "@input/pen-snapshots",
				field: "dependencies",
				dependency: "@input/pen-types",
				reason: "P.8 conversion deferred — workspace:* packs to an exact version (F34).",
			},
		],
		jsArtifacts: [
			{
				package: "@input/pen-snapshots",
				reason: "P.8 conversion deferred — ESM export is ./dist/index.js (F34).",
			},
		],
	};

	const matching = evaluatePins({
		packages: [core, history],
		allowlist,
	});
	assert(
		matching.unexpectedPins.length === 0 &&
			matching.stalePins.length === 0 &&
			matching.unexpectedJs.length === 0 &&
			matching.staleJs.length === 0,
		"self-test: matching allowlist must not fail",
	);
	assert(
		matching.allowedPins.length === 2,
		"self-test: expected two allowlisted workspace:* pins",
	);
	assert(
		matching.caretPins.length === 1 &&
			matching.caretPins[0].dependency === "@input/pen-schema",
		"self-test: workspace:^ is desired, not a violation",
	);
	assert(
		matching.allowedJs.length === 1 &&
			matching.allowedJs[0].package === "@input/pen-snapshots",
		"self-test: history .js export is allowlisted",
	);
	assert(
		matching.mjsPackages.length === 1 &&
			matching.mjsPackages[0] === "@input/pen-core",
		"self-test: core .mjs export is counted",
	);
	assert(!hasFailures(matching), "self-test: matching tree must pass");

	const unmarked = evaluatePins({
		packages: [
			{
				...core,
				pins: [
					...core.pins,
					{
						field: "dependencies",
						dependency: "@input/pen-react",
						spec: STAR_PIN,
					},
				],
			},
			history,
		],
		allowlist,
	});
	assert(
		unmarked.unexpectedPins.some(
			(pin) =>
				pin.package === "@input/pen-core" &&
				pin.dependency === "@input/pen-react",
		),
		"self-test: unmarked workspace:* must fail",
	);
	assert(hasFailures(unmarked), "self-test: unmarked pin fails the check");

	const stale = evaluatePins({
		packages: [
			{
				...core,
				pins: [
					{
						field: "dependencies",
						dependency: "@input/pen-schema",
						spec: DESIRED_PIN,
					},
				],
			},
			history,
		],
		allowlist,
	});
	assert(
		stale.stalePins.some(
			(entry) =>
				entry.package === "@input/pen-core" &&
				entry.dependency === "@input/pen-types",
		),
		"self-test: converted pin must be a stale allowlist entry",
	);

	const newJs = evaluatePins({
		packages: [
			core,
			history,
			fixturePkg({
				name: "@input/pen-search",
				pins: [],
				esmArtifact: "./dist/index.js",
				sideEffects: false,
			}),
		],
		allowlist,
	});
	assert(
		newJs.unexpectedJs.some((hit) => hit.package === "@input/pen-search"),
		"self-test: unmarked dist/index.js must fail",
	);

	const sideEffectsOnly = evaluatePins({
		packages: [
			core,
			history,
			fixturePkg({
				name: "@input/pen-ai-autocomplete",
				pins: [],
				esmArtifact: "./dist/index.mjs",
				sideEffects: true,
			}),
		],
		allowlist,
	});
	assert(
		sideEffectsOnly.sideEffectsHits.length === 1 &&
			sideEffectsOnly.sideEffectsHits[0].package ===
				"@input/pen-ai-autocomplete",
		"self-test: sideEffects: true is reported",
	);
	assert(
		hasFailures(sideEffectsOnly),
		"self-test: sideEffects !== false fails closed",
	);

	const converted = evaluatePins({
		packages: [
			fixturePkg({
				name: "@input/pen-core",
				pins: [
					{
						field: "dependencies",
						dependency: "@input/pen-types",
						spec: DESIRED_PIN,
					},
				],
				esmArtifact: "./dist/index.mjs",
				sideEffects: false,
			}),
			fixturePkg({
				name: "@input/pen-snapshots",
				pins: [
					{
						field: "dependencies",
						dependency: "@input/pen-types",
						spec: DESIRED_PIN,
					},
				],
				esmArtifact: "./dist/index.mjs",
				sideEffects: false,
			}),
		],
		allowlist: { workspaceStar: [], jsArtifacts: [] },
	});
	assert(
		converted.starHits.length === 0 &&
			converted.jsHits.length === 0 &&
			converted.stalePins.length === 0 &&
			converted.staleJs.length === 0 &&
			!hasFailures(converted),
		"self-test: converted workspace:^ / .mjs tree must pass with an empty allowlist",
	);

	assert(
		collectWorkspacePins({
			dependencies: {
				"@input/pen-types": STAR_PIN,
				react: "^19",
			},
			peerDependencies: {
				"@input/pen-import-html": STAR_PIN,
			},
			devDependencies: {
				"@input/pen-test": STAR_PIN,
			},
		})
			.map((pin) => `${pin.field}:${pin.dependency}`)
			.join(",") ===
			"dependencies:@input/pen-types,peerDependencies:@input/pen-import-html",
		"self-test: only dependencies and peerDependencies are pin-checked",
	);
	assert(
		isJsIndexArtifact("./dist/index.js") &&
			!isJsIndexArtifact("./dist/index.mjs"),
		"self-test: .js vs .mjs artifact detection",
	);

	const parsed = parseAllowlist({
		workspaceStar: [
			{
				package: "@input/pen-core",
				field: "dependencies",
				dependency: "@input/pen-types",
				reason: "P.8 / F34 conversion deferred",
			},
		],
		jsArtifacts: [
			{
				package: "@input/pen-snapshots",
				reason: "P.8 / F34 dist/index.js",
			},
		],
	});
	assert(
		parsed.workspaceStar.length === 1 && parsed.jsArtifacts.length === 1,
		"self-test: parseAllowlist accepts a valid file",
	);
}

function fixturePkg(pkg) {
	return pkg;
}

function pinKey(entry) {
	return `${entry.package}\0${entry.field}\0${entry.dependency}`;
}

function comparePin(left, right) {
	return (
		left.field.localeCompare(right.field) ||
		left.dependency.localeCompare(right.dependency)
	);
}

function compareStar(left, right) {
	return (
		left.package.localeCompare(right.package) ||
		left.field.localeCompare(right.field) ||
		left.dependency.localeCompare(right.dependency)
	);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

export async function loadPublishedPackages(repoRoot) {
	const manifests = await loadPublishedManifests(repoRoot);
	return manifests.map(({ name, dir, packageJson }) => ({
		name,
		dir,
		packageJson,
		pins: collectWorkspacePins(packageJson),
		esmArtifact: esmArtifactPath(packageJson),
		sideEffects: packageJson.sideEffects,
	}));
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
		"API7 P.8 self-test ok (fixture object; unmarked workspace:*, dist/index.js, and sideEffects !== false all fail closed)",
	);
	if (args.selfTestOnly) {
		return;
	}

	const packages = await loadPublishedPackages(args.repoRoot);
	if (packages.length === 0) {
		console.error(
			"workspace-pins: cannot check: packages/**/package.json walk matched 0 published manifests",
		);
		process.exitCode = 1;
		return;
	}
	console.log(
		`population: ${packages.length} published manifests (packages/**/package.json)`,
	);
	const allowlist = await loadAllowlist(args.repoRoot);
	const result = evaluatePins({ packages, allowlist });
	console.log("");
	console.log(formatReport(result));
	if (hasFailures(result)) {
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
