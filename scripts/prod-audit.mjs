#!/usr/bin/env node
/**
 * SEC7: no production advisory may reach a published package.
 *
 * Root `pnpm audit --prod` has no workspace filter, so it also reports
 * advisories that only reach private workspaces (playground, examples,
 * docs, conformance), which never ship. This keeps the advisories whose
 * install path starts at a published importer and fails on any of them,
 * whatever the severity.
 *
 * An install path's first `>`-separated segment names the importer: its
 * pnpm-lock.yaml importer id with `/` encoded as `__`
 * (`packages__extensions__interop>isomorphic-dompurify>jsdom>undici`),
 * and `.` for the root. Older output spelled the id literally, sometimes
 * with spaces around `>`; both spellings resolve. The inline predecessor
 * of this script matched only the literal spelling, so every pnpm 10
 * path was filed as out of scope and the gate could not fail.
 *
 * Fail-closed, each by name:
 *   - a path whose importer segment is no lockfile importer (pnpm changed
 *     its path format again; a filter that cannot place a path must not
 *     drop it),
 *   - an advisory with no install paths,
 *   - a report that is not JSON, carries `error`, or lacks `advisories`
 *     (a registry failure is not a clean audit),
 *   - a non-zero pnpm exit alongside zero advisories,
 *   - a missing lockfile, an importer without a package.json, or a
 *     lockfile with no importer or no published importer (skip of
 *     nothing).
 *
 * Reads the lockfile without a YAML dependency because the audit job does
 * not install the workspace. Self-tests on every run.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(SCRIPT_DIR, "..");
const LOCKFILE = "pnpm-lock.yaml";
const AUDIT_ARGS = ["audit", "--prod", "--json"];
/** A two-space-indented key directly under `importers:`. */
const IMPORTER_KEY_RE = /^ {2}(\S.*):$/;

const isRecord = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const byModuleThenUrl = (a, b) =>
	a.module.localeCompare(b.module) || a.url.localeCompare(b.url);

/** File contents, or null when the file does not exist. */
function readOptional(file) {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

function importerIdFromLine(line) {
	const match = IMPORTER_KEY_RE.exec(line);
	return match ? [match[1].replace(/^(['"])(.*)\1$/, "$2")] : [];
}

/** Importer ids (`.`, `packages/core`, ...) from the `importers:` block. */
export function parseLockfileImporters(lockfileText) {
	const lines = lockfileText.split(/\r?\n/);
	const start = lines.indexOf("importers:") + 1;
	if (start === 0) return [];
	const rest = lines.slice(start);
	const end = rest.findIndex((line) => /^\S/.test(line));
	return (end === -1 ? rest : rest.slice(0, end)).flatMap(importerIdFromLine);
}

function describeImporter(repoRoot, id) {
	const text = readOptional(join(repoRoot, id, "package.json"));
	if (text === null) return { id, hasManifest: false, published: false };
	const manifest = JSON.parse(text);
	return {
		id,
		hasManifest: true,
		published:
			manifest.private !== true && typeof manifest.name === "string",
	};
}

export function collectWorkspace(repoRoot) {
	const lockfileText = readOptional(join(repoRoot, LOCKFILE));
	if (lockfileText === null) return { missingLockfile: true, importers: [] };
	return {
		missingLockfile: false,
		importers: parseLockfileImporters(lockfileText).map((id) =>
			describeImporter(repoRoot, id),
		),
	};
}

/** The first `>`-separated segment of an install path, trimmed. */
export function importerSegment(path) {
	return path.split(">")[0].trim();
}

/**
 * Maps both spellings of each importer id to the id. Matching against the
 * encoded form, rather than decoding `__` back to `/`, keeps a directory
 * whose own name contains `__` resolvable.
 */
export function buildImporterIndex(ids) {
	const index = new Map();
	const entries = ids.flatMap((id) => [
		[id, id],
		[id.replaceAll("/", "__"), id],
	]);
	for (const [key, id] of entries) {
		const existing = index.get(key) ?? id;
		if (existing !== id) {
			throw new Error(
				`SEC7: importers ${existing} and ${id} share the audit path segment "${key}"`,
			);
		}
		index.set(key, id);
	}
	return index;
}

function workspaceErrors(workspace) {
	if (workspace.missingLockfile) {
		return [`SEC7: missing ${LOCKFILE} (skip of nothing)`];
	}
	if (workspace.importers.length === 0) {
		return [`SEC7: ${LOCKFILE} lists no importers (skip of nothing)`];
	}
	const errors = workspace.importers
		.filter((importer) => !importer.hasManifest)
		.map(
			(importer) =>
				`SEC7: lockfile importer ${importer.id} has no package.json, so whether it is published is unknown`,
		);
	if (!workspace.importers.some((importer) => importer.published)) {
		errors.push(
			`SEC7: no published importer in ${LOCKFILE} (skip of nothing)`,
		);
	}
	return errors;
}

function auditErrorMessage(error) {
	const { code = "unknown", message = "" } = isRecord(error) ? error : {};
	return `SEC7: pnpm audit reported an error instead of a result: ${code} ${message}`.trim();
}

function reportErrors(report) {
	if (!isRecord(report)) {
		return ["SEC7: pnpm audit --json did not return a JSON object"];
	}
	if (report.error !== undefined) return [auditErrorMessage(report.error)];
	if (!isRecord(report.advisories)) {
		return ["SEC7: pnpm audit report has no advisories object"];
	}
	return [];
}

function toRow(advisory) {
	return {
		module: String(advisory.module_name),
		severity: String(advisory.severity),
		title: String(advisory.title),
		url: String(advisory.url),
		patched: String(advisory.patched_versions),
		paths: (advisory.findings ?? []).flatMap(
			(finding) => finding.paths ?? [],
		),
	};
}

function placePaths(paths, index, publishedIds) {
	const publishedPaths = [];
	const unknownPaths = [];
	for (const path of paths) {
		const id = index.get(importerSegment(path));
		if (id === undefined) unknownPaths.push(path);
		else if (publishedIds.has(id)) publishedPaths.push(path);
	}
	return { publishedPaths, unknownPaths };
}

function scopeAdvisories(advisories, importers) {
	const index = buildImporterIndex(importers.map((importer) => importer.id));
	const publishedIds = new Set(
		importers
			.filter((importer) => importer.published)
			.map((importer) => importer.id),
	);
	const scoped = { published: [], outOfScope: [], pathless: [], unknown: [] };
	for (const advisory of advisories) {
		const row = toRow(advisory);
		const placed = placePaths(row.paths, index, publishedIds);
		scoped.unknown.push(...placed.unknownPaths);
		if (row.paths.length === 0) scoped.pathless.push(row);
		else if (placed.publishedPaths.length > 0) {
			scoped.published.push({ ...row, paths: placed.publishedPaths });
		} else scoped.outOfScope.push(row);
	}
	return scoped;
}

function scopeErrors(scoped, exitStatus, advisoryCount) {
	const errors = scoped.pathless.map(
		(row) =>
			`SEC7: ${row.severity} ${row.module} ${row.url} has no install path to scope`,
	);
	const bySegment = new Map(
		scoped.unknown.map((path) => [importerSegment(path), path]),
	);
	for (const [segment, path] of bySegment) {
		errors.push(
			`SEC7: install path starts at "${segment}", which is no ${LOCKFILE} importer; pnpm audit's path format may have changed (${path})`,
		);
	}
	if (exitStatus !== 0 && advisoryCount === 0) {
		errors.push(
			`SEC7: pnpm audit exited ${exitStatus} but reported no advisories`,
		);
	}
	return errors;
}

/**
 * `ok` only when the inputs are trustworthy and no advisory has a path
 * that starts at a published importer.
 */
export function evaluateAudit({ report, exitStatus, workspace }) {
	const inputErrors = [
		...workspaceErrors(workspace),
		...reportErrors(report),
	];
	if (inputErrors.length > 0) {
		return {
			ok: false,
			errors: inputErrors,
			published: [],
			outOfScope: [],
			advisoryCount: 0,
		};
	}
	const advisories = Object.values(report.advisories);
	const scoped = scopeAdvisories(advisories, workspace.importers);
	const errors = scopeErrors(scoped, exitStatus, advisories.length);
	return {
		ok: errors.length === 0 && scoped.published.length === 0,
		errors,
		published: scoped.published.sort(byModuleThenUrl),
		outOfScope: scoped.outOfScope.sort(byModuleThenUrl),
		advisoryCount: advisories.length,
	};
}

const SELF_TEST_LOCKFILE = [
	"lockfileVersion: '9.0'",
	"",
	"importers:",
	"",
	"  .:",
	"    devDependencies:",
	"      tsup:",
	"        specifier: ^8.4.0",
	"  'examples/react':",
	"    dependencies: {}",
	"  packages/extensions/interop:",
	"    dependencies: {}",
	"",
	"packages:",
	"",
	"  undici@8.11.2:",
].join("\n");

const SELF_TEST_WORKSPACE = {
	missingLockfile: false,
	importers: [
		{ id: ".", hasManifest: true, published: false },
		{ id: "examples/react", hasManifest: true, published: false },
		{ id: "playground", hasManifest: true, published: false },
		{
			id: "packages/extensions/interop",
			hasManifest: true,
			published: true,
		},
		{
			id: "packages/tooling/__fixtures__",
			hasManifest: true,
			published: true,
		},
	],
};

function fakeAdvisory(module, paths) {
	return {
		module_name: module,
		severity: "high",
		title: `${module} advisory`,
		url: `https://github.com/advisories/GHSA-${module}`,
		patched_versions: ">=9.0.0",
		findings: [{ version: "1.0.0", paths }],
	};
}

function fakeReport(...advisories) {
	const entries = advisories.map((advisory, i) => [String(i + 1), advisory]);
	return { advisories: Object.fromEntries(entries), metadata: {} };
}

function selfTestAudit(
	report,
	exitStatus = 1,
	workspace = SELF_TEST_WORKSPACE,
) {
	return evaluateAudit({ report, exitStatus, workspace });
}

const failsWith = (result, pattern) =>
	!result.ok && result.errors.some((error) => pattern.test(error));

const blocksPublished = (result, pathCount = 1) =>
	!result.ok &&
	result.errors.length === 0 &&
	result.published.length === 1 &&
	result.published[0].paths.length === pathCount;

/** Each check returns true when the gate behaves; a false names the hole. */
const SELF_TESTS = [
	[
		"lockfile importers parse to ids, quoted or not",
		() =>
			parseLockfileImporters(SELF_TEST_LOCKFILE).join(",") ===
			".,examples/react,packages/extensions/interop",
	],
	[
		"the importer segment is the first `>` segment, trimmed",
		() =>
			importerSegment(" packages/extensions/interop > jsdom > undici") ===
			"packages/extensions/interop",
	],
	[
		"a pnpm 10 `__` path into a published package must fail (the inline gate filed it out of scope)",
		() =>
			blocksPublished(
				selfTestAudit(
					fakeReport(
						fakeAdvisory("undici", [
							"packages__extensions__interop>isomorphic-dompurify>jsdom>undici",
						]),
					),
				),
			),
	],
	[
		"a literal ` > ` path into a published package must fail",
		() =>
			blocksPublished(
				selfTestAudit(
					fakeReport(
						fakeAdvisory("undici", [
							"packages/extensions/interop > isomorphic-dompurify > jsdom > undici",
						]),
					),
				),
			),
	],
	[
		"an importer whose own name contains `__` still resolves",
		() =>
			blocksPublished(
				selfTestAudit(
					fakeReport(
						fakeAdvisory("ws", [
							"packages__tooling____fixtures__>ws",
						]),
					),
				),
			),
	],
	[
		"one published path among private paths must fail and list only the published path",
		() =>
			blocksPublished(
				selfTestAudit(
					fakeReport(
						fakeAdvisory("undici", [
							"playground>wrangler>miniflare>undici",
							"packages__extensions__interop>isomorphic-dompurify>jsdom>undici",
						]),
					),
				),
			),
	],
	[
		"advisories reaching only private importers and the root pass as out of scope",
		() => {
			const result = selfTestAudit(
				fakeReport(
					fakeAdvisory("ws", ["playground>wrangler>ws"]),
					fakeAdvisory("@babel/core", [
						"examples__react>@vitejs/plugin-react>@babel/core",
					]),
					fakeAdvisory("esbuild", [".>tsup>esbuild"]),
				),
			);
			return result.ok && result.outOfScope.length === 3;
		},
	],
	[
		"a path whose importer is not in the lockfile must fail closed by name",
		() =>
			failsWith(
				selfTestAudit(
					fakeReport(
						fakeAdvisory("undici", [
							"packages::extensions::interop>jsdom>undici",
						]),
					),
				),
				/no pnpm-lock\.yaml importer/,
			),
	],
	[
		"an advisory without install paths must fail closed by name",
		() =>
			failsWith(
				selfTestAudit(fakeReport(fakeAdvisory("undici", []))),
				/no install path/,
			),
	],
	[
		"an audit error object must fail closed by name",
		() =>
			failsWith(
				selfTestAudit({
					error: {
						code: "ECONNREFUSED",
						message: "connect ECONNREFUSED",
					},
				}),
				/ECONNREFUSED/,
			),
	],
	[
		"a report without an advisories object must fail closed",
		() =>
			failsWith(
				selfTestAudit({ metadata: {} }, 0),
				/no advisories object/,
			),
	],
	[
		"a non-zero exit with zero advisories must fail closed",
		() => failsWith(selfTestAudit(fakeReport(), 1), /exited 1/),
	],
	["a clean audit must pass", () => selfTestAudit(fakeReport(), 0).ok],
	[
		"a missing lockfile must fail closed by name",
		() =>
			failsWith(
				selfTestAudit(fakeReport(), 0, {
					missingLockfile: true,
					importers: [],
				}),
				/missing pnpm-lock\.yaml/,
			),
	],
	[
		"a lockfile without importers must fail closed by name",
		() =>
			failsWith(
				selfTestAudit(fakeReport(), 0, {
					missingLockfile: false,
					importers: [],
				}),
				/no importers/,
			),
	],
	[
		"a workspace with no published importer must fail closed by name",
		() =>
			failsWith(
				selfTestAudit(fakeReport(), 0, {
					missingLockfile: false,
					importers: [
						{ id: ".", hasManifest: true, published: false },
					],
				}),
				/no published importer/,
			),
	],
	[
		"an importer without a package.json must fail closed by name",
		() =>
			failsWith(
				selfTestAudit(fakeReport(), 0, {
					missingLockfile: false,
					importers: [
						...SELF_TEST_WORKSPACE.importers,
						{
							id: "packages/gone",
							hasManifest: false,
							published: false,
						},
					],
				}),
				/packages\/gone has no package\.json/,
			),
	],
];

export function runSelfTests() {
	for (const [name, check] of SELF_TESTS) {
		if (!check()) throw new Error(`self-test: ${name}`);
	}
}

function readArgs(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			"repo-root": { type: "string", default: DEFAULT_REPO_ROOT },
			"self-test": { type: "boolean", default: false },
		},
		strict: true,
	});
	return { repoRoot: values["repo-root"], selfTestOnly: values["self-test"] };
}

function runAudit(repoRoot) {
	const result = spawnSync("pnpm", AUDIT_ARGS, {
		cwd: repoRoot,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error) {
		return {
			error: `SEC7: pnpm audit failed to start: ${result.error.message}`,
		};
	}
	try {
		return { report: JSON.parse(result.stdout), exitStatus: result.status };
	} catch {
		return {
			error: `SEC7: pnpm audit --json did not return JSON\n${(result.stderr || result.stdout).slice(0, 2000)}`,
		};
	}
}

function printOutOfScope(rows) {
	if (rows.length === 0) return;
	console.log(
		`Out of scope (${rows.length}): install paths start only at private importers or the root.`,
	);
	for (const row of rows) {
		console.log(
			`  ${row.severity} ${row.module} ${row.url}  (${row.paths[0]})`,
		);
	}
}

function printPublished(rows) {
	if (rows.length === 0) return;
	console.error(
		`SEC7: ${rows.length} production advisories reach published packages:`,
	);
	for (const row of rows) {
		console.error(`  ${row.severity} ${row.module}  ${row.title}`);
		console.error(`    ${row.url}  patched ${row.patched}`);
		for (const path of row.paths) console.error(`    ${path}`);
	}
}

function printResult(result, workspace) {
	const publishedCount = workspace.importers.filter(
		(importer) => importer.published,
	).length;
	console.log(
		`SEC7: ${workspace.importers.length} lockfile importers, ${publishedCount} published. Root production audit reported ${result.advisoryCount} advisories.`,
	);
	printOutOfScope(result.outOfScope);
	for (const error of result.errors) console.error(error);
	printPublished(result.published);
	if (result.ok) {
		console.log("SEC7: no production advisory reaches a published package");
	}
}

function main() {
	runSelfTests();
	console.log(
		`SEC7 prod-audit self-test ok (${SELF_TESTS.length} cases: \`__\` and literal paths into a published package fail; unknown importers, pathless advisories, audit errors, and empty workspaces fail closed)`,
	);

	const args = readArgs(process.argv.slice(2));
	if (args.selfTestOnly) return;

	const workspace = collectWorkspace(args.repoRoot);
	const audit = runAudit(args.repoRoot);
	if (audit.error) {
		console.error(audit.error);
		process.exitCode = 1;
		return;
	}
	const result = evaluateAudit({ ...audit, workspace });
	printResult(result, workspace);
	process.exitCode = result.ok ? 0 : 1;
}

// Compare real paths: on macOS /tmp is a symlink, and a gate that exits 0
// without running when invoked through one has failed open.
const isDirectRun =
	process.argv[1] !== undefined &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
