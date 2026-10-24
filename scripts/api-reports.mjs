#!/usr/bin/env node
/**
 * API4 API-report check (spec/rules/api.md).
 *
 * Asserts three properties, named separately because they are not the same:
 *
 * 1. Report drift — the committed `api-report.md` matches the export names
 *    parsed from that package's published `.d.ts`. A mismatch is the
 *    public-export-name gate; CONTRIBUTING also asks for the `api-change`
 *    label and a changeset. `--write` refreshes the files from the current
 *    `.d.ts`.
 *
 *    The report is a name inventory: exported symbol names grouped by kind.
 *    It does not record signatures, interface fields, or union members. A
 *    breaking shape change (required field, widened union, changed return
 *    type) produces no report diff. That is the intended coverage — the
 *    gate answers "did the export set change", not "did a public type's
 *    shape change". Shape breaks still need a changeset; they are not
 *    this script's job.
 *
 * 2. Dist freshness — no type-input file under `src/` (production `.ts` /
 *    `.tsx` / `.mts` / `.cts`, not tests) has an mtime newer than the
 *    package's published root `.d.ts`. This is an mtime comparison, not a
 *    content-identity check. A format-only touch can trip it.
 *
 * 3. Unbound value exports — a published `.d.ts` `export { Name }` (no
 *    `type` keyword, no `from`) whose `Name` is neither imported nor
 *    declared in that file. That is the declaration-bundler flatten of a
 *    type-only `export { Name }`: the identifier is in the file and in the
 *    name inventory, and a host still cannot resolve it. Workspace `tsc`
 *    uses `skipLibCheck` and will not see it. A `from` re-export is bound
 *    to the named module and is not this class.
 *
 * Freshness is a local guard. CI runs `pnpm build` first, so the `.d.ts` is
 * current by construction and this path does not fire there. Do not add a
 * CI flag for it.
 *
 * Default: if any package fails (2), the script refuses a pass. Matching
 * reports against a `.d.ts` that predates its source is inconclusive, not
 * OK. `--allow-stale-dist` continues anyway and still prints the named
 * packages; `--write` is also refused unless that flag is set, so a stale
 * `.d.ts` cannot be recorded as the public surface.
 *
 * "stale" in older output meant report drift only. The three questions now
 * have three names.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	appendOutdatedDistLines,
	assessDistFreshness,
	isTypeInputFile,
	listTypeInputFiles,
	runFreshnessSelfTests as runSharedFreshnessSelfTests,
	typesSpecifier,
} from "./lib/distFreshness.mjs";

export {
	assessDistFreshness,
	isTypeInputFile,
	listTypeInputFiles,
	rootTypesSpecifier,
	typesSpecifier,
} from "./lib/distFreshness.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const REPORT_NAME = "api-report.md";

const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	"dist",
	"coverage",
	".turbo",
	".git",
	"playwright-report",
	"test-results",
]);

const KIND_ORDER = ["class", "function", "guard", "value", "type"];

export function splitExportSpecifiers(inner) {
	const specs = [];
	for (const raw of inner.split(",")) {
		const spec = raw.trim();
		if (spec.length === 0) {
			continue;
		}
		const typeOnly = spec.startsWith("type ");
		const rest = typeOnly ? spec.slice(5).trim() : spec;
		const renamed = rest.match(/^(\S+)\s+as\s+(\S+)$/);
		specs.push({
			typeOnly,
			local: renamed ? renamed[1] : rest,
			exported: renamed ? renamed[2] : rest,
		});
	}
	return specs;
}

export function collectExportNames(text) {
	const names = new Map();
	// tsup 9 emits type exports as a separate `export type { Name }` statement.
	for (const match of text.matchAll(/export\s*(type\s*)?\{([^}]+)\}/g)) {
		const typeStatement = match[1] != null;
		for (const spec of splitExportSpecifiers(match[2])) {
			names.set(spec.exported, typeStatement || spec.typeOnly);
		}
	}
	const named = [
		[/export\s+type\s+(\w+)/g, true],
		[/export\s+interface\s+(\w+)/g, true],
		[/export\s+(?:declare\s+)?(?:async\s+)?function\s+(\w+)/g, false],
		[/export\s+(?:declare\s+)?class\s+(\w+)/g, false],
		[/export\s+(?:declare\s+)?const\s+(\w+)/g, false],
	];
	for (const [pattern, typeOnly] of named) {
		for (const match of text.matchAll(pattern)) {
			if (!names.has(match[1])) {
				names.set(match[1], typeOnly);
			}
		}
	}
	return names;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declarationKind(text, name) {
	const escaped = escapeRegExp(name);
	const functionRe = new RegExp(
		`(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?function\\s+${escaped}\\b[^{;]*`,
		"g",
	);
	const functionHits = [...text.matchAll(functionRe)].map(
		(match) => match[0],
	);
	if (functionHits.length > 0) {
		if (functionHits.some((hit) => /\):\s*\S+\s+is\b/.test(hit))) {
			return "guard";
		}
		return "function";
	}
	const classRe = new RegExp(
		`(?:export\\s+)?(?:declare\\s+)?class\\s+${escaped}\\b`,
	);
	if (classRe.test(text)) {
		return "class";
	}
	return "value";
}

export function collectImportedBindingNames(text) {
	const names = new Set();
	for (const match of text.matchAll(/\bimport\s*(?:type\s*)?\{([^}]+)\}/g)) {
		for (const spec of splitExportSpecifiers(match[1])) {
			names.add(spec.exported);
		}
	}
	return names;
}

export function collectLocalBindingNames(text) {
	const names = new Set();
	const patterns = [
		/(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s+(\w+)/g,
		/(?:export\s+)?(?:declare\s+)?class\s+(\w+)/g,
		/(?:export\s+)?(?:declare\s+)?const\s+(\w+)/g,
		/(?:export\s+)?(?:declare\s+)?enum\s+(\w+)/g,
		/(?:export\s+)?type\s+(\w+)/g,
		/(?:export\s+)?interface\s+(\w+)/g,
	];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			names.add(match[1]);
		}
	}
	return names;
}

/**
 * Value-style `export { Name }` with no `from` and no local/import binding.
 * `export { type Name }` and `export { Name } from "mod"` are not this class.
 */
export function findUnboundValueExports(text) {
	const imported = collectImportedBindingNames(text);
	const local = collectLocalBindingNames(text);
	const unbound = [];
	for (const match of text.matchAll(
		/export\s*\{([^}]+)\}(\s*from\s*('[^']+'|"[^"]+"))?/g,
	)) {
		const from = match[2] ?? null;
		for (const spec of splitExportSpecifiers(match[1])) {
			if (spec.typeOnly || from != null) {
				continue;
			}
			if (imported.has(spec.local) || local.has(spec.local)) {
				continue;
			}
			unbound.push(spec.exported);
		}
	}
	return unbound;
}

export function classifyExports(text) {
	const names = collectExportNames(text);
	const entries = [];
	for (const [name, typeOnly] of names) {
		if (typeOnly) {
			entries.push({ name, kind: "type" });
			continue;
		}
		entries.push({ name, kind: declarationKind(text, name) });
	}
	entries.sort((left, right) => {
		const kind =
			KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
		if (kind !== 0) {
			return kind;
		}
		return left.name.localeCompare(right.name);
	});
	return entries;
}

export function renderApiReport({ packageName, surfaces }) {
	const lines = [`# ${packageName}`, ""];
	for (const surface of surfaces) {
		lines.push(`## ${surface.key}`);
		lines.push("");
		lines.push(`\`${surface.typesPath}\``);
		lines.push("");
		if (surface.globFiles) {
			lines.push("glob members:");
			lines.push("");
			for (const file of surface.globFiles) {
				lines.push(`- ${file}`);
			}
			if (surface.globFiles.length === 0) {
				lines.push("_no matching files_");
			}
			lines.push("");
			continue;
		}
		let currentKind = null;
		for (const entry of surface.entries) {
			if (entry.kind !== currentKind) {
				if (currentKind !== null) {
					lines.push("");
				}
				lines.push(`### ${entry.kind}`);
				lines.push("");
				currentKind = entry.kind;
			}
			lines.push(`- ${entry.name}`);
		}
		if (surface.entries.length === 0) {
			lines.push("_no exports_");
		}
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

async function expandTypesGlob(packageDir, specifier) {
	const star = specifier.indexOf("*");
	const prefix = specifier.slice(0, star);
	const suffix = specifier.slice(star + 1);
	const directory = path.join(packageDir, prefix);
	let names;
	try {
		names = await fs.readdir(directory);
	} catch (error) {
		if (error && error.code === "ENOENT") {
			return { status: "missing", files: [] };
		}
		throw error;
	}
	const files = names
		.filter((name) => name.endsWith(suffix) && !name.endsWith(".d.cts"))
		.sort((left, right) => left.localeCompare(right));
	return { status: "ok", files };
}

export function exportKeys(manifest) {
	const exportsField = manifest.exports;
	if (exportsField == null || typeof exportsField === "string") {
		return ["."];
	}
	if (typeof exportsField !== "object" || Array.isArray(exportsField)) {
		return ["."];
	}
	// a subpath resolving straight to a .json file (`./package.json`) is a
	// manifest passthrough, not a typed entry point, so it carries no surface
	const keys = Object.keys(exportsField).filter((key) => {
		const target = exportsField[key];
		return !(typeof target === "string" && target.endsWith(".json"));
	});
	return keys.length > 0 ? keys : ["."];
}

async function collectPackageJsonPaths(directory, files) {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!IGNORE_DIR_NAMES.has(entry.name)) {
				await collectPackageJsonPaths(entryPath, files);
			}
			continue;
		}
		if (entry.isFile() && entry.name === "package.json") {
			files.push(entryPath);
		}
	}
}

export async function loadPublishedPackages(repoRoot) {
	const files = [];
	await collectPackageJsonPaths(path.join(repoRoot, "packages"), files);
	const packages = [];
	for (const filePath of files) {
		const packageJson = JSON.parse(await fs.readFile(filePath, "utf8"));
		if (
			packageJson.private === true ||
			typeof packageJson.name !== "string"
		) {
			continue;
		}
		packages.push({
			name: packageJson.name,
			dir: path.dirname(filePath),
			keys: exportKeys(packageJson),
			packageJson,
		});
	}
	packages.sort((left, right) => left.name.localeCompare(right.name));
	return packages;
}

export async function buildPackageReport(pkg) {
	const surfaces = [];
	const missing = [];
	const unboundExports = [];
	const exportsField = pkg.packageJson.exports;
	for (const key of pkg.keys) {
		const entry =
			exportsField == null || typeof exportsField === "string"
				? { types: pkg.packageJson.types ?? "./dist/index.d.ts" }
				: exportsField[key];
		const specifier =
			typesSpecifier(entry) ??
			(key === "."
				? (pkg.packageJson.types ?? "./dist/index.d.ts")
				: null);
		if (specifier == null) {
			missing.push(`${pkg.name} ${key}: no types specifier`);
			continue;
		}
		if (specifier.includes("*")) {
			const expanded = await expandTypesGlob(pkg.dir, specifier);
			if (expanded.status === "missing") {
				missing.push(
					`${pkg.name} ${key}: missing ${specifier} (run pnpm build)`,
				);
				continue;
			}
			surfaces.push({
				key,
				typesPath: specifier,
				globFiles: expanded.files,
				entries: [],
			});
			continue;
		}
		const typesPath = path.join(pkg.dir, specifier);
		try {
			const text = await fs.readFile(typesPath, "utf8");
			surfaces.push({
				key,
				typesPath: specifier,
				entries: classifyExports(text),
			});
			for (const name of findUnboundValueExports(text)) {
				unboundExports.push(
					`${pkg.name} ${key}: ${name} in ${specifier}`,
				);
			}
		} catch (error) {
			if (error && error.code === "ENOENT") {
				missing.push(
					`${pkg.name} ${key}: missing ${specifier} (run pnpm build)`,
				);
				continue;
			}
			throw error;
		}
	}
	return {
		report: renderApiReport({ packageName: pkg.name, surfaces }),
		missing,
		unboundExports,
		reportPath: path.join(pkg.dir, REPORT_NAME),
	};
}

export function diffReports(expected, actual) {
	if (expected === actual) {
		return null;
	}
	return { expected, actual };
}

export function runSelfTests() {
	const dts = `
declare function isFoo(value: unknown): value is Foo;
declare function isBar(value: unknown): value is {
    ok: true;
};
declare function doWork(value: string): string;
declare class Box {}
declare const FLAG = 1;
type Foo = { ok: true };
export { type Foo, isFoo, isBar, doWork, Box, FLAG };
`;
	const entries = classifyExports(dts);
	const byName = Object.fromEntries(
		entries.map((entry) => [entry.name, entry.kind]),
	);
	if (byName.Foo !== "type") {
		throw new Error("self-test: type export");
	}
	if (byName.isFoo !== "guard" || byName.isBar !== "guard") {
		throw new Error("self-test: type-predicate function is a guard");
	}
	if (byName.doWork !== "function") {
		throw new Error("self-test: plain function");
	}
	if (byName.Box !== "class") {
		throw new Error("self-test: class");
	}
	if (byName.FLAG !== "value") {
		throw new Error("self-test: const");
	}
	const statementTypes = Object.fromEntries(
		classifyExports(
			`interface Bar {}\ndeclare function make(): Bar;\nexport { make };\nexport type { Bar };\n`,
		).map((entry) => [entry.name, entry.kind]),
	);
	if (statementTypes.Bar !== "type" || statementTypes.make !== "function") {
		throw new Error("self-test: export type statement lists type exports");
	}

	const merged = exportKeys({
		exports: {
			".": { import: { types: "./dist/index.d.ts" } },
			"./suggestions": { import: { types: "./dist/suggestions.d.ts" } },
			"./package.json": "./package.json",
		},
	});
	if (!merged.includes("./suggestions")) {
		throw new Error("self-test: typed subpath stays an entry point");
	}
	if (merged.includes("./package.json")) {
		throw new Error(
			"self-test: manifest passthrough is not an entry point",
		);
	}

	const rendered = renderApiReport({
		packageName: "@input/pen-types",
		surfaces: [{ key: ".", typesPath: "./dist/index.d.ts", entries }],
	});
	if (!rendered.startsWith("# @input/pen-types\n")) {
		throw new Error("self-test: report title");
	}
	if (!rendered.includes("### guard\n\n- isBar\n- isFoo")) {
		throw new Error("self-test: guard section");
	}

	const shapeBefore = `
interface Rec { readonly id: string; }
type Aff = "a" | "b";
declare function make(): string;
export { type Rec, type Aff, make };
`;
	const shapeAfter = `
interface Rec { readonly id: string; readonly extra: string; }
type Aff = "a" | "b" | "c";
declare function make(): number;
export { type Rec, type Aff, make };
`;
	const nameAdded = `
interface Rec { readonly id: string; }
type Aff = "a" | "b";
declare function make(): string;
export { type Rec, type Aff, make, type Extra };
`;
	const shapeSurface = (text) =>
		renderApiReport({
			packageName: "@input/pen-shape-fixture",
			surfaces: [
				{
					key: ".",
					typesPath: "./dist/index.d.ts",
					entries: classifyExports(text),
				},
			],
		});
	if (shapeSurface(shapeBefore) !== shapeSurface(shapeAfter)) {
		throw new Error(
			"self-test: name inventory is stable across breaking shape changes",
		);
	}
	if (shapeSurface(shapeBefore) === shapeSurface(nameAdded)) {
		throw new Error(
			"self-test: adding an exported name must change the report",
		);
	}

	const unbound = findUnboundValueExports("export { PhantomName };\n");
	if (unbound.length !== 1 || unbound[0] !== "PhantomName") {
		throw new Error(
			"self-test: bare value export with no binding is unbound",
		);
	}
	if (
		findUnboundValueExports("export { type PhantomName };\n").length !== 0
	) {
		throw new Error(
			"self-test: type-only specifier is not an unbound value",
		);
	}
	if (
		findUnboundValueExports(
			'export { PhantomName } from "@input/pen-types";\n',
		).length !== 0
	) {
		throw new Error(
			"self-test: from-reexport is bound to the named module",
		);
	}
	if (
		findUnboundValueExports(
			"type PhantomName = { ok: true };\nexport { PhantomName };\n",
		).length !== 0
	) {
		throw new Error(
			"self-test: local type declaration binds a value-style export",
		);
	}
	if (
		findUnboundValueExports(
			'import { PhantomName } from "@input/pen-types";\nexport { PhantomName };\n',
		).length !== 0
	) {
		throw new Error("self-test: imported name binds a value-style export");
	}
	if (
		findUnboundValueExports(
			"export { MissingLocal as PublicName };\n",
		).join(",") !== "PublicName"
	) {
		throw new Error("self-test: unbound alias reports the exported name");
	}

	if (isTypeInputFile("src/index.ts") !== true) {
		throw new Error("self-test: src/index.ts is a type input");
	}
	if (isTypeInputFile("src/editor/apply.tsx") !== true) {
		throw new Error("self-test: src tsx is a type input");
	}
	if (isTypeInputFile("src/foo.test.ts") !== false) {
		throw new Error("self-test: colocated test is not a type input");
	}
	if (isTypeInputFile("src/__tests__/bar.ts") !== false) {
		throw new Error("self-test: __tests__ is not a type input");
	}
	if (isTypeInputFile("README.md") !== false) {
		throw new Error("self-test: non-src is not a type input");
	}
	if (isTypeInputFile("package.json") !== false) {
		throw new Error("self-test: package.json is not a type input");
	}
}

async function runFreshnessSelfTests() {
	await runSharedFreshnessSelfTests();
	const tmpRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "pen-api-reports-"),
	);
	try {
		await runFreshnessSelfTestsIn(tmpRoot);
	} finally {
		await fs.rm(tmpRoot, { recursive: true, force: true });
	}
}

async function runFreshnessSelfTestsIn(tmpRoot) {
	const packageDir = path.join(tmpRoot, "pkg");
	const srcDir = path.join(packageDir, "src");
	const distDir = path.join(packageDir, "dist");
	const testsDir = path.join(srcDir, "__tests__");
	await fs.mkdir(testsDir, { recursive: true });
	await fs.mkdir(distDir, { recursive: true });
	await fs.writeFile(
		path.join(packageDir, "package.json"),
		`${JSON.stringify({
			name: "@input/pen-freshness-fixture",
			types: "./dist/index.d.ts",
			exports: { ".": { types: "./dist/index.d.ts" } },
		})}\n`,
	);
	const srcPath = path.join(srcDir, "index.ts");
	const testPath = path.join(srcDir, "index.test.ts");
	const nestedTestPath = path.join(testsDir, "hidden.ts");
	const dtsPath = path.join(distDir, "index.d.ts");
	const dts = "export declare const FLAG: 1;\n";
	await fs.writeFile(srcPath, "export const FLAG = 1;\n");
	await fs.writeFile(testPath, "export const TEST = 1;\n");
	await fs.writeFile(nestedTestPath, "export const HIDDEN = 1;\n");
	await fs.writeFile(dtsPath, dts);

	const listed = await listTypeInputFiles(packageDir);
	if (listed.map((file) => file.relativePosix).join(",") !== "src/index.ts") {
		throw new Error("self-test: type inputs exclude tests");
	}

	const past = new Date("2020-01-01T00:00:00.000Z");
	const recent = new Date("2026-08-21T00:00:00.000Z");
	await fs.utimes(dtsPath, past, past);
	await fs.utimes(srcPath, recent, recent);
	await fs.utimes(testPath, recent, recent);

	const fixturePkg = {
		name: "@input/pen-freshness-fixture",
		dir: packageDir,
		keys: ["."],
		packageJson: JSON.parse(
			await fs.readFile(path.join(packageDir, "package.json"), "utf8"),
		),
	};

	const outdated = await assessDistFreshness(fixturePkg);
	if (outdated.status !== "outdated") {
		throw new Error("self-test: newer src mtime is outdated dist");
	}
	if (
		outdated.newer.length !== 1 ||
		outdated.newer[0].relativePosix !== "src/index.ts"
	) {
		throw new Error("self-test: outdated dist names the newer type input");
	}

	await fs.utimes(dtsPath, recent, recent);
	await fs.utimes(srcPath, past, past);
	const fresh = await assessDistFreshness(fixturePkg);
	if (fresh.status !== "fresh" || fresh.newer.length !== 0) {
		throw new Error("self-test: older src mtime is fresh dist");
	}

	const reportPath = path.join(packageDir, REPORT_NAME);
	const matchingReport = renderApiReport({
		packageName: fixturePkg.name,
		surfaces: [
			{
				key: ".",
				typesPath: "./dist/index.d.ts",
				entries: classifyExports(dts),
			},
		],
	});
	await fs.writeFile(reportPath, matchingReport);

	await fs.utimes(srcPath, recent, recent);
	await fs.utimes(dtsPath, past, past);
	const named = await evaluateApiReports({
		packages: [fixturePkg],
		write: false,
	});
	if (named.outdatedDist.length !== 1) {
		throw new Error("self-test: evaluate reports outdated dist");
	}
	if (named.outdatedDist[0].package !== fixturePkg.name) {
		throw new Error("self-test: outdated dist names the package");
	}
	if (named.outdatedDist[0].newerCount !== 1) {
		throw new Error("self-test: outdated dist counts newer type inputs");
	}
	if (named.reportDrift.length !== 0) {
		throw new Error("self-test: matching report is not drift");
	}

	const printed = formatReport(named, { allowStaleDist: false });
	if (printed.includes("OK:")) {
		throw new Error("self-test: outdated dist must not print OK");
	}
	if (!printed.includes("INCONCLUSIVE:")) {
		throw new Error("self-test: outdated dist prints INCONCLUSIVE");
	}
	if (!printed.includes(fixturePkg.name)) {
		throw new Error("self-test: INCONCLUSIVE names the package");
	}

	const allowed = formatReport(named, { allowStaleDist: true });
	if (
		!allowed.includes(
			"OK: committed API reports match the published .d.ts surfaces.",
		)
	) {
		throw new Error(
			"self-test: --allow-stale-dist may still pass the report check",
		);
	}

	await fs.appendFile(reportPath, "- FakeLane151Symbol\n");
	const drifted = await evaluateApiReports({
		packages: [fixturePkg],
		write: false,
	});
	if (drifted.reportDrift.length !== 1) {
		throw new Error("self-test: injected symbol is report drift");
	}
	if (drifted.reportDrift[0].package !== fixturePkg.name) {
		throw new Error("self-test: report drift names the package");
	}

	const blocked = await evaluateApiReports({
		packages: [fixturePkg],
		write: true,
		allowStaleDist: false,
	});
	if (blocked.written.length !== 0) {
		throw new Error("self-test: --write is refused on outdated dist");
	}
	if (blocked.writeBlocked.length !== 1) {
		throw new Error("self-test: --write names the blocked package");
	}

	if (named.packageCount !== 1) {
		throw new Error("self-test: package count is the examined population");
	}

	const phantomDts = "export { PhantomName };\n";
	await fs.writeFile(dtsPath, phantomDts);
	await fs.utimes(dtsPath, recent, recent);
	await fs.utimes(srcPath, past, past);
	const phantomReport = renderApiReport({
		packageName: fixturePkg.name,
		surfaces: [
			{
				key: ".",
				typesPath: "./dist/index.d.ts",
				entries: classifyExports(phantomDts),
			},
		],
	});
	await fs.writeFile(reportPath, phantomReport);
	const phantom = await evaluateApiReports({
		packages: [fixturePkg],
		write: false,
	});
	if (phantom.reportDrift.length !== 0) {
		throw new Error(
			"self-test: phantom name still matches the name inventory",
		);
	}
	if (phantom.unboundExports.length !== 1) {
		throw new Error("self-test: phantom value export is unbound");
	}
	if (!phantom.unboundExports[0].includes("PhantomName")) {
		throw new Error("self-test: unbound export names the identifier");
	}
}

function parseArgs(argv) {
	let repoRoot = DEFAULT_REPO_ROOT;
	let write = false;
	let allowStaleDist = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--repo-root") {
			repoRoot = path.resolve(argv[i + 1] ?? "");
			i += 1;
			continue;
		}
		if (arg === "--write") {
			write = true;
			continue;
		}
		if (arg === "--allow-stale-dist") {
			allowStaleDist = true;
			continue;
		}
		throw new Error(`Unknown flag: ${arg}`);
	}
	return { repoRoot, write, allowStaleDist };
}

export async function evaluateApiReports({
	packages,
	write,
	allowStaleDist = false,
}) {
	const reportDrift = [];
	const missing = [];
	const unboundExports = [];
	const written = [];
	const writeBlocked = [];
	const outdatedDist = [];
	for (const pkg of packages) {
		const freshness = await assessDistFreshness(pkg);
		if (freshness.status === "outdated") {
			outdatedDist.push({
				package: pkg.name,
				newerCount: freshness.newer.length,
			});
		}
		const built = await buildPackageReport(pkg);
		missing.push(...built.missing);
		unboundExports.push(...built.unboundExports);
		if (built.missing.length > 0) {
			continue;
		}
		let committed = null;
		try {
			committed = await fs.readFile(built.reportPath, "utf8");
		} catch (error) {
			if (error && error.code !== "ENOENT") {
				throw error;
			}
		}
		if (write) {
			if (freshness.status === "outdated" && !allowStaleDist) {
				writeBlocked.push(pkg.name);
				continue;
			}
			await fs.writeFile(built.reportPath, built.report);
			written.push(pkg.name);
			continue;
		}
		if (committed == null || committed !== built.report) {
			reportDrift.push({
				package: pkg.name,
				path: built.reportPath,
				missing: committed == null,
			});
		}
	}
	return {
		packageCount: packages.length,
		reportDrift,
		missing,
		unboundExports,
		written,
		writeBlocked,
		outdatedDist,
	};
}

export function formatReport(result, { allowStaleDist = false } = {}) {
	const lines = ["API4 API reports"];
	lines.push("");
	lines.push(`published packages     ${result.packageCount}`);
	lines.push(`report drift           ${result.reportDrift.length}`);
	lines.push(`missing .d.ts          ${result.missing.length}`);
	lines.push(`unbound value exports  ${result.unboundExports.length}`);
	lines.push(
		`outdated dist          ${result.outdatedDist.length}${
			allowStaleDist && result.outdatedDist.length > 0 ? " (allowed)" : ""
		}`,
	);
	if (result.written.length > 0) {
		lines.push(`written                ${result.written.length}`);
	}
	if (result.writeBlocked.length > 0) {
		lines.push(`write blocked          ${result.writeBlocked.length}`);
	}
	if (result.reportDrift.length > 0) {
		lines.push("");
		lines.push(
			"report drift (run `node scripts/api-reports.mjs --write` after a fresh build):",
		);
		for (const hit of result.reportDrift) {
			lines.push(
				`  ${hit.package}${hit.missing ? " (missing file)" : ""}`,
			);
		}
	}
	if (result.missing.length > 0) {
		lines.push("");
		lines.push("missing type artifacts:");
		for (const hit of result.missing) {
			lines.push(`  ${hit}`);
		}
	}
	if (result.unboundExports.length > 0) {
		lines.push("");
		lines.push(
			"unbound value exports (name in the .d.ts export list with no binding):",
		);
		for (const hit of result.unboundExports) {
			lines.push(`  ${hit}`);
		}
	}
	appendOutdatedDistLines(lines, result.outdatedDist);
	if (result.writeBlocked.length > 0) {
		lines.push("");
		lines.push(
			"refusing --write: recording reports from an outdated .d.ts would hide source drift. Rebuild, or pass --allow-stale-dist.",
		);
		for (const name of result.writeBlocked) {
			lines.push(`  ${name}`);
		}
	}

	const hasDrift =
		result.reportDrift.length > 0 ||
		result.missing.length > 0 ||
		result.unboundExports.length > 0;
	const hasOutdated = result.outdatedDist.length > 0;
	if (!hasDrift && !hasOutdated && result.writeBlocked.length === 0) {
		lines.push("");
		lines.push(
			"OK: committed API reports match the published .d.ts surfaces.",
		);
	} else if (!hasDrift && hasOutdated && allowStaleDist) {
		lines.push("");
		lines.push(
			"warning: verdict is against a .d.ts that may predate source.",
		);
		lines.push(
			"OK: committed API reports match the published .d.ts surfaces.",
		);
	} else if (!hasDrift && hasOutdated && !allowStaleDist) {
		lines.push("");
		lines.push(
			`INCONCLUSIVE: reports match the .d.ts, but ${result.outdatedDist.length} package(s) have type-input source newer than dist. That is not a pass.`,
		);
	} else if (hasDrift && hasOutdated && !allowStaleDist) {
		lines.push("");
		lines.push(
			`INCONCLUSIVE: ${result.outdatedDist.length} package(s) have type-input source newer than dist; report drift may be incomplete until those rebuild.`,
		);
	}
	return lines.join("\n");
}

function hasGateFailure(result, allowStaleDist) {
	if (
		result.reportDrift.length > 0 ||
		result.missing.length > 0 ||
		result.unboundExports.length > 0
	) {
		return true;
	}
	if (result.writeBlocked.length > 0) {
		return true;
	}
	if (result.outdatedDist.length > 0 && !allowStaleDist) {
		return true;
	}
	return false;
}

async function main() {
	runSelfTests();
	await runFreshnessSelfTests();
	console.log("API4 api-reports self-test ok");

	const args = parseArgs(process.argv.slice(2));
	const packages = await loadPublishedPackages(args.repoRoot);
	if (packages.length === 0) {
		console.error(
			"api-reports: cannot check: packages/**/package.json walk matched 0 published manifests",
		);
		process.exitCode = 1;
		return;
	}
	console.log(
		`population: ${packages.length} published manifests (packages/**/package.json)`,
	);
	const result = await evaluateApiReports({
		packages,
		write: args.write,
		allowStaleDist: args.allowStaleDist,
	});
	console.log("");
	console.log(formatReport(result, { allowStaleDist: args.allowStaleDist }));
	if (hasGateFailure(result, args.allowStaleDist)) {
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
