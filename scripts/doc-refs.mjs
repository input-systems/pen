#!/usr/bin/env node
/**
 * DOC1 package/version gate and DOC2 sample typecheck
 * (spec/rules/documentation.md).
 *
 * Checks markdown that adopters read (root README, CONTRIBUTING,
 * examples, per-package READMEs):
 *   - every `@input/pen-*` name (and optional version / export subpath)
 *     resolves in the workspace
 *   - every published package has a row in the root README package
 *     table, companions labelled `Companion:` in their description —
 *     the reverse direction of that walk (DOC1/SF7: the documented set
 *     equals the published set, so a package cannot be installable but
 *     invisible, and a companion cannot pose as a host install)
 *   - every ts/tsx/vue sample type-checks against built `.d.ts`
 *   - every `spec/packages/**.md` version claim matches the manifest at
 *     the workspace path that spec states (API7/DOC1). The version-suffix
 *     walk above only sees `pkg@version` forms, so a prose sentence like
 *     "at version `0.0.1`" was invisible to it and drifted at the first
 *     release; this reads the claim through the spec's own stated path
 *     rather than inferring a package from the file's location.
 *
 * Hits fail the process. A missing `dist/*.d.ts` is also a failure —
 * run `pnpm build` first; this gate reads published artifacts, not source.
 *
 * Availability and currency are different questions about the same
 * file. Missing dist is the existing failure. Type-input source newer
 * than the published `.d.ts` is INCONCLUSIVE — samples that type-check
 * against a `.d.ts` that predates source are not a pass.
 *
 * Dist freshness is a local guard. CI runs `pnpm build` first
 * (`static-gates.yml` doc-refs job), so the `.d.ts` is current by
 * construction and this path does not fire there. Do not add a CI
 * flag for it.
 */

import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
	appendOutdatedDistLines,
	collectOutdatedDist,
	runFreshnessSelfTests,
} from "./lib/distFreshness.mjs";
import { isCompanionPackage } from "./readme-sections.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	"dist",
	".generated",
	"coverage",
	".turbo",
	".git",
	"playwright-report",
	"test-results",
]);

const PKG_NAME_RE = /@input\/pen-[a-z0-9-]+/g;
const VERSION_SUFFIX_RE = /^@([^\s`)"'\]]+)/;
const SUBPATH_RE = /^\/[A-Za-z0-9._-]+/;
const FENCE_RE = /```(ts|tsx|js|jsx|vue|typescript|javascript)\b[^\n]*\n([\s\S]*?)```/gi;

const SAMPLE_LANG = new Set([
	"ts",
	"tsx",
	"js",
	"jsx",
	"vue",
	"typescript",
	"javascript",
]);

export function parsePackageRef(raw, after = "") {
	const name = raw;
	const glob = after.startsWith("*");
	let rest = glob ? after.slice(1) : after;
	let subpath = "";
	let version = null;
	if (!glob && rest.startsWith("/")) {
		const match = rest.match(SUBPATH_RE);
		if (match) {
			subpath = match[0];
			rest = rest.slice(subpath.length);
		}
	}
	if (!glob && rest.startsWith("@")) {
		const match = rest.match(VERSION_SUFFIX_RE);
		if (match) {
			version = match[1];
		}
	}
	return { name, subpath, version, glob };
}

export function extractPackageRefs(text) {
	const refs = [];
	for (const match of text.matchAll(PKG_NAME_RE)) {
		const after = text.slice(match.index + match[0].length);
		refs.push({
			...parsePackageRef(match[0], after),
			index: match.index,
		});
	}
	return refs;
}

export function versionSatisfies(spec, version) {
	if (spec === version || spec === "*" || spec === "latest") {
		return true;
	}
	const parsedVersion = parseSemver(version);
	if (!parsedVersion) {
		return false;
	}
	if (spec.startsWith("^")) {
		const want = parseSemver(spec.slice(1));
		if (!want) {
			return false;
		}
		if (want.major === 0 && want.minor === 0) {
			return (
				parsedVersion.major === 0 &&
				parsedVersion.minor === 0 &&
				parsedVersion.patch >= want.patch
			);
		}
		if (want.major === 0) {
			return (
				parsedVersion.major === 0 &&
				parsedVersion.minor === want.minor &&
				parsedVersion.patch >= want.patch
			);
		}
		return (
			parsedVersion.major === want.major &&
			compareSemver(parsedVersion, want) >= 0
		);
	}
	if (spec.startsWith("~")) {
		const want = parseSemver(spec.slice(1));
		if (!want) {
			return false;
		}
		return (
			parsedVersion.major === want.major &&
			parsedVersion.minor === want.minor &&
			parsedVersion.patch >= want.patch
		);
	}
	return spec === version;
}

function parseSemver(value) {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
	if (!match) {
		return null;
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

function compareSemver(left, right) {
	if (left.major !== right.major) {
		return left.major - right.major;
	}
	if (left.minor !== right.minor) {
		return left.minor - right.minor;
	}
	return left.patch - right.patch;
}

export function exportKeys(manifest) {
	const field = manifest.exports;
	if (field == null || typeof field === "string") {
		return new Set(["."]);
	}
	if (typeof field !== "object" || Array.isArray(field)) {
		return new Set(["."]);
	}
	const keys = Object.keys(field);
	return new Set(keys.length > 0 ? keys : ["."]);
}

export function extractFencedSamples(text, file) {
	const samples = [];
	const pattern = new RegExp(FENCE_RE.source, FENCE_RE.flags);
	let index = 0;
	for (const match of text.matchAll(pattern)) {
		const lang = (match[1] ?? "").toLowerCase();
		if (!SAMPLE_LANG.has(lang)) {
			continue;
		}
		index += 1;
		samples.push({
			file,
			index,
			lang: normalizeLang(lang),
			code: match[2] ?? "",
			kind: "fence",
		});
	}
	return samples;
}

function normalizeLang(lang) {
	if (lang === "typescript") {
		return "ts";
	}
	if (lang === "javascript") {
		return "js";
	}
	return lang;
}

export function vueScript(code) {
	const openEnd = findScriptOpenEnd(code);
	if (openEnd === -1) {
		return null;
	}
	const closeStart = findScriptCloseStart(code, openEnd);
	if (closeStart === -1) {
		return null;
	}
	return code.slice(openEnd, closeStart);
}

function findScriptOpenEnd(code) {
	const lower = code.toLowerCase();
	let from = 0;
	while (from < lower.length) {
		const at = lower.indexOf("<script", from);
		if (at === -1) {
			return -1;
		}
		const afterName = at + "<script".length;
		const next = code[afterName];
		if (next !== undefined && next !== ">" && !isHtmlNameBoundary(next)) {
			from = afterName;
			continue;
		}
		const gt = code.indexOf(">", afterName);
		return gt === -1 ? -1 : gt + 1;
	}
	return -1;
}

function findScriptCloseStart(code, from) {
	const lower = code.toLowerCase();
	const needle = "</script";
	let i = from;
	while (i < lower.length) {
		const at = lower.indexOf(needle, i);
		if (at === -1) {
			return -1;
		}
		const afterName = at + needle.length;
		const gt = code.indexOf(">", afterName);
		if (gt !== -1) {
			return at;
		}
		i = afterName;
	}
	return -1;
}

function isHtmlNameBoundary(ch) {
	return ch === "/" || ch === "\t" || ch === "\n" || ch === "\r" || ch === " " || ch === ">";
}

export function sampleFilename(sample) {
	if (sample.lang === "tsx" || sample.lang === "jsx") {
		return `${safeSampleId(sample)}.tsx`;
	}
	if (sample.lang === "vue") {
		return `${safeSampleId(sample)}.ts`;
	}
	return `${safeSampleId(sample)}.ts`;
}

function safeSampleId(sample) {
	const stem = sample.file
		.replaceAll("\\", "/")
		.replaceAll("/", "__")
		.replaceAll(".", "_");
	return `${stem}__${sample.index}`;
}

export function prepareSampleSource(sample) {
	if (sample.lang === "vue") {
		const script = vueScript(sample.code);
		if (script === null) {
			return { skip: "vue-template-only" };
		}
		return { source: script };
	}
	const trimmed = sample.code.trim();
	if (trimmed.length === 0) {
		return { skip: "empty" };
	}
	return { source: sample.code };
}

export function evaluateRefs({ refs, packages }) {
	const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
	const missing = [];
	const seen = new Set();

	for (const ref of refs) {
		const key = `${ref.file}:${ref.name}${ref.glob ? "*" : ""}${ref.subpath}${ref.version ? `@${ref.version}` : ""}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);

		if (ref.glob) {
			const prefix = `${ref.name}`;
			const matches = packages.filter((pkg) => pkg.name.startsWith(prefix));
			if (matches.length === 0) {
				missing.push({
					file: ref.file,
					ref: `${ref.name}*`,
					reason: "no workspace package matches this prefix",
				});
			}
			continue;
		}

		const pkg = byName.get(ref.name);
		if (!pkg) {
			missing.push({
				file: ref.file,
				ref: ref.name,
				reason: "package does not exist in the workspace",
			});
			continue;
		}

		if (ref.version && !versionSatisfies(ref.version, pkg.version)) {
			missing.push({
				file: ref.file,
				ref: `${ref.name}@${ref.version}`,
				reason: `workspace version is ${pkg.version}`,
			});
		}

		if (ref.subpath) {
			const keyName = `.${ref.subpath}`;
			if (!pkg.exports.has(keyName)) {
				missing.push({
					file: ref.file,
					ref: `${ref.name}${ref.subpath}`,
					reason: `exports map has no ${keyName}`,
				});
			}
		}
	}

	missing.sort((left, right) =>
		`${left.file}${left.ref}`.localeCompare(`${right.file}${right.ref}`),
	);
	return missing;
}

export function evaluateReadmeCoverage({ readme, packages }) {
	// table rows only: a prose or code-fence mention is not a catalog entry
	const tableRows = new Map();
	for (const line of readme.split("\n")) {
		if (!line.trimStart().startsWith("|")) {
			continue;
		}
		const nameMatch = line.match(/`(@input\/pen(?:-[a-z][a-z-]*)?)`/);
		if (nameMatch) {
			tableRows.set(nameMatch[1], line);
		}
	}
	const published = packages
		.filter(
			(pkg) => pkg.dir.startsWith("packages/") && pkg.manifest.private !== true,
		)
		.map((pkg) => pkg.name)
		.sort();
	const missing = published.filter((name) => !tableRows.has(name));
	const unlabeled = published.filter(
		(name) =>
			isCompanionPackage(name) &&
			tableRows.has(name) &&
			!tableRows.get(name).includes("Companion:"),
	);
	return { missing, unlabeled };
}

export function evaluateSpecVersions({ specs, packages }) {
	const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));
	const stale = [];
	const unmapped = [];
	for (const spec of specs) {
		const claimed = spec.text.match(/at version `([^`]+)`/);
		if (!claimed) {
			continue;
		}
		// the spec states its own workspace path; resolve through that rather
		// than guessing a package from the spec's location
		const workspacePath = spec.text.match(/Path in workspace: `([^`]+)`/);
		const pkg = workspacePath ? byDir.get(workspacePath[1]) : undefined;
		if (!pkg) {
			unmapped.push({ file: spec.file, claimed: claimed[1] });
			continue;
		}
		if (claimed[1] !== pkg.version) {
			stale.push({
				file: spec.file,
				claimed: claimed[1],
				actual: pkg.version,
				name: pkg.name,
			});
		}
	}
	return { stale, unmapped };
}

function completeReadmeFixture() {
	return `# fixture

Install \`@input/pen-core\`.

\`\`\`ts
import { createEditor } from "@input/pen-core";
const editor = createEditor();
void editor;
\`\`\`
`;
}

export function runSelfTests() {
	const refs = extractPackageRefs(
		"use @input/pen-core and @input/pen-react/ai and @input/pen-core@^1.0.0 and @input/pen-example-*",
	);
	assert(
		refs.some((ref) => ref.name === "@input/pen-core" && !ref.version && !ref.subpath),
		"self-test: bare package name",
	);
	assert(
		refs.some((ref) => ref.name === "@input/pen-react" && ref.subpath === "/ai"),
		"self-test: export subpath",
	);
	assert(
		refs.some((ref) => ref.name === "@input/pen-core" && ref.version === "^1.0.0"),
		"self-test: version pin",
	);
	assert(
		refs.some((ref) => ref.name === "@input/pen-example-" && ref.glob),
		"self-test: glob prefix",
	);

	assert(versionSatisfies("0.0.1", "0.0.1"), "self-test: exact version");
	assert(!versionSatisfies("^1.0.0", "0.0.1"), "self-test: ^1 does not match 0.0.1");
	assert(versionSatisfies("^0.0.1", "0.0.1"), "self-test: ^0.0.1 matches 0.0.1");

	const packages = [
		{
			name: "@input/pen-core",
			version: "0.0.1",
			exports: new Set(["."]),
		},
		{
			name: "@input/pen-react",
			version: "0.0.1",
			exports: new Set([".", "./ai"]),
		},
		{
			name: "@input/pen-example-react",
			version: "0.0.0",
			exports: new Set(["."]),
		},
	];

	const ok = evaluateRefs({
		refs: [
			{ file: "README.md", name: "@input/pen-core", subpath: "", version: null, glob: false },
			{ file: "README.md", name: "@input/pen-react", subpath: "/ai", version: null, glob: false },
			{ file: "README.md", name: "@input/pen-example-", subpath: "", version: null, glob: true },
		],
		packages,
	});
	assert(ok.length === 0, "self-test: known refs must pass");

	const missing = evaluateRefs({
		refs: [
			{
				file: "README.md",
				name: "@input/pen-does-not-exist",
				subpath: "",
				version: null,
				glob: false,
			},
			{
				file: "README.md",
				name: "@input/pen-core",
				subpath: "",
				version: "^1.0.0",
				glob: false,
			},
			{
				file: "README.md",
				name: "@input/pen-react",
				subpath: "/missing",
				version: null,
				glob: false,
			},
		],
		packages,
	});
	assert(
		missing.some((hit) => hit.ref === "@input/pen-does-not-exist"),
		"self-test: missing package fails",
	);
	assert(
		missing.some((hit) => hit.ref === "@input/pen-core@^1.0.0"),
		"self-test: wrong version fails",
	);
	assert(
		missing.some((hit) => hit.ref === "@input/pen-react/missing"),
		"self-test: missing subpath fails",
	);

	const samples = extractFencedSamples(completeReadmeFixture(), "README.md");
	assert(samples.length === 1 && samples[0].lang === "ts", "self-test: fence extract");

	const vue = vueScript("<template><div /></template>");
	assert(vue === null, "self-test: template-only vue is skipped");
	assert(
		vueScript("<script>const x = 1</script >") === "const x = 1",
		"self-test: vue script close tag allows whitespace",
	);
	assert(
		vueScript("<script>const x = 1</script\t\n bar>") === "const x = 1",
		"self-test: vue script close tag allows attributes",
	);

	const coverage = evaluateReadmeCoverage({
		readme: [
			"Install `@input/pen-assets`.",
			"",
			"| Package | Description |",
			"| --- | --- |",
			"| `@input/pen-core` | The runtime |",
			"| `@input/pen-types` | Companion: shared contracts |",
			"| `@input/pen-markdown` | Markdown export |",
		].join("\n"),
		packages: [
			{ name: "@input/pen-core", dir: "packages/core", manifest: {} },
			{
				name: "@input/pen-assets",
				dir: "packages/tooling/assets",
				manifest: {},
			},
			{ name: "@input/pen-types", dir: "packages/types", manifest: {} },
			{
				name: "@input/pen-markdown",
				dir: "packages/shared/markdown",
				manifest: {},
			},
			{ name: "@input/pen-docs", dir: "packages/docs", manifest: { private: true } },
			{ name: "@input/pen-example-react", dir: "examples/react", manifest: {} },
		],
	});
	assert(
		coverage.missing.join(",") === "@input/pen-assets",
		"self-test: a published package with a prose mention but no table row fails closed, while private and example packages do not",
	);
	assert(
		coverage.unlabeled.join(",") === "@input/pen-markdown",
		"self-test: a companion table row without the Companion: label fails closed",
	);

	const specVersions = evaluateSpecVersions({
		specs: [
			{
				file: "spec/packages/core.md",
				text: "Path in workspace: `packages/core`\n\nWorkspace package at version `0.1.0`;",
			},
			{
				file: "spec/packages/types.md",
				text: "Path in workspace: `packages/types`\n\nWorkspace package at version `0.0.1`;",
			},
			{
				file: "spec/packages/playground.md",
				text: "Path in workspace: `playground`\n\nNo version claim here.",
			},
			{
				file: "spec/packages/ghost.md",
				text: "Workspace package at version `0.1.0`; but states no workspace path",
			},
		],
		packages: [
			{ name: "@input/pen-core", dir: "packages/core", version: "0.1.0", manifest: {} },
			{ name: "@input/pen-types", dir: "packages/types", version: "0.1.0", manifest: {} },
		],
	});
	assert(
		specVersions.stale.length === 1 &&
			specVersions.stale[0].file === "spec/packages/types.md" &&
			specVersions.stale[0].claimed === "0.0.1" &&
			specVersions.stale[0].actual === "0.1.0",
		"self-test: a spec version claim that the manifest contradicts fails closed, and a matching one passes",
	);
	assert(
		specVersions.unmapped.length === 1 &&
			specVersions.unmapped[0].file === "spec/packages/ghost.md",
		"self-test: a version claim with no resolvable workspace path fails closed; a spec with no claim is not flagged",
	);

	const cleanTypecheck = { errors: [], skipped: [], checked: 1 };
	const outdatedOnly = {
		missingRefs: [],
		typecheck: cleanTypecheck,
		artifacts: [],
		outdatedDist: [{ package: "@input/pen-core", newerCount: 1 }],
	};
	assert(!hasFailures(outdatedOnly), "self-test: outdated dist is not a ref failure");
	assert(hasInconclusive(outdatedOnly), "self-test: outdated dist is inconclusive");
	const outdatedReport = formatReport(outdatedOnly);
	assert(outdatedReport.includes("INCONCLUSIVE:"), "self-test: outdated dist prints INCONCLUSIVE");
	assert(
		!outdatedReport.includes("FAIL missing built type artifacts"),
		"self-test: outdated dist is not a missing artifact",
	);
	assert(outdatedReport.includes("@input/pen-core"), "self-test: INCONCLUSIVE names the package");

	const missingAndOutdated = {
		missingRefs: [],
		typecheck: cleanTypecheck,
		artifacts: [{ package: "@input/pen-core", path: "packages/core/dist/index.d.ts" }],
		outdatedDist: [{ package: "@input/pen-ai", newerCount: 1 }],
	};
	assert(hasFailures(missingAndOutdated), "self-test: missing dist still fails when another package is outdated");
	const missingReport = formatReport(missingAndOutdated);
	if (!missingReport.includes("FAIL missing built type artifacts")) {
		throw new Error("self-test: outdated dist does not hide a missing artifact");
	}
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function collectFiles(directory, predicate, acc = []) {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!IGNORE_DIR_NAMES.has(entry.name)) {
				await collectFiles(entryPath, predicate, acc);
			}
			continue;
		}
		if (entry.isFile() && predicate(entryPath, entry.name)) {
			acc.push(entryPath);
		}
	}
	return acc;
}

export async function loadNamedPackages(repoRoot) {
	// pnpm-workspace.yaml also lists `playground`. It is private, so the
	// published-set walks below skip it, but prose that names it must still
	// resolve — DOC1 asks whether a name exists in the workspace, not whether
	// it ships.
	const packageJsonPaths = [
		...(await collectFiles(path.join(repoRoot, "packages"), (_p, name) => name === "package.json")),
		...(await collectFiles(path.join(repoRoot, "examples"), (_p, name) => name === "package.json")),
		path.join(repoRoot, "playground", "package.json"),
	];
	const packages = [];
	for (const packageJsonPath of packageJsonPaths) {
		const manifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
		if (typeof manifest.name !== "string") {
			continue;
		}
		packages.push({
			name: manifest.name,
			version: typeof manifest.version === "string" ? manifest.version : "0.0.0",
			dir: path.relative(repoRoot, path.dirname(packageJsonPath)).split(path.sep).join("/"),
			exports: exportKeys(manifest),
			manifest,
		});
	}
	packages.sort((left, right) => left.name.localeCompare(right.name));
	return packages;
}

export async function loadDocFiles(repoRoot) {
	const files = [
		path.join(repoRoot, "README.md"),
		path.join(repoRoot, "CONTRIBUTING.md"),
		...(await collectFiles(path.join(repoRoot, "examples"), (_p, name) => name === "README.md")),
		...(await collectFiles(path.join(repoRoot, "packages"), (_p, name) => name === "README.md")),
	];
	const docs = [];
	for (const filePath of files) {
		let text = "";
		try {
			text = await fs.readFile(filePath, "utf8");
		} catch {
			continue;
		}
		docs.push({
			file: path.relative(repoRoot, filePath).split(path.sep).join("/"),
			path: filePath,
			text,
		});
	}
	return docs;
}

export async function loadSpecFiles(repoRoot) {
	const files = await collectFiles(
		path.join(repoRoot, "spec", "packages"),
		(_p, name) => name.endsWith(".md"),
	);
	const specs = [];
	for (const filePath of files) {
		specs.push({
			file: path.relative(repoRoot, filePath).split(path.sep).join("/"),
			text: await fs.readFile(filePath, "utf8"),
		});
	}
	specs.sort((left, right) => left.file.localeCompare(right.file));
	return specs;
}

const EXAMPLE_SNIPPET_SOURCES = [
	"examples/react/src/App.tsx",
	"examples/vue/src/App.vue",
	"examples/vanilla/src/main.ts",
];

/**
 * Reads each listed example entry as a DOC2 sample. A listed source that is
 * missing is returned in `missing`, not skipped: a renamed entry file would
 * otherwise drop out of the type-check silently (HB3).
 */
export async function loadExampleSources(repoRoot) {
	const sources = [];
	const missing = [];
	for (const rel of EXAMPLE_SNIPPET_SOURCES) {
		const text = await readFileOrNull(path.join(repoRoot, rel));
		if (text === null) {
			missing.push(rel);
			continue;
		}
		const ext = path.extname(rel).slice(1);
		sources.push({
			file: rel,
			index: 0,
			lang: ext === "vue" ? "vue" : ext,
			code: text,
			kind: "source",
		});
	}
	return { sources, missing };
}

async function readFileOrNull(filePath) {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

/** HB3: a repo root without the example entries fails by name. */
async function runExampleSourceSelfTests() {
	const empty = await fs.mkdtemp(path.join(os.tmpdir(), "doc-refs-examples-"));
	try {
		const { sources, missing } = await loadExampleSources(empty);
		assert(
			sources.length === 0 && missing.length === EXAMPLE_SNIPPET_SOURCES.length,
			"self-test: a missing example source must be reported, not skipped",
		);
	} finally {
		await fs.rm(empty, { recursive: true, force: true });
	}
}

function reportMissingExampleSources(missing) {
	for (const rel of missing) {
		console.log(`FAIL example source missing: ${rel}`);
	}
	if (missing.length > 0) {
		process.exitCode = 1;
	}
}

function typesEntry(manifest, repoRoot, dir, key) {
	const field = manifest.exports?.[key] ?? manifest.exports?.["."];
	const types =
		field?.import?.types ??
		field?.types ??
		(typeof field === "string" ? null : null);
	if (typeof types === "string") {
		return path.join(repoRoot, dir, types);
	}
	if (typeof manifest.types === "string") {
		return path.join(repoRoot, dir, manifest.types);
	}
	return path.join(repoRoot, dir, "dist/index.d.ts");
}

export async function missingTypeArtifacts(packages, repoRoot) {
	const missing = [];
	for (const pkg of packages) {
		if (pkg.dir.startsWith("examples/")) {
			continue;
		}
		if (pkg.manifest.private === true) {
			continue;
		}
		const typesPath = typesEntry(pkg.manifest, repoRoot, pkg.dir, ".");
		try {
			await fs.access(typesPath);
		} catch {
			missing.push({
				package: pkg.name,
				path: path.relative(repoRoot, typesPath).split(path.sep).join("/"),
			});
		}
	}
	return missing;
}

function compilerPaths(packages, repoRoot) {
	const paths = {};
	for (const pkg of packages) {
		if (pkg.dir.startsWith("examples/") || pkg.manifest.private === true) {
			continue;
		}
		for (const key of pkg.exports) {
			const spec = key === "." ? pkg.name : `${pkg.name}${key.slice(1)}`;
			const typesPath = typesEntry(pkg.manifest, repoRoot, pkg.dir, key);
			paths[spec] = [typesPath];
		}
	}
	Object.assign(paths, hostCompilerPaths(repoRoot));
	return paths;
}

function hostCompilerPaths(repoRoot) {
	const paths = {};
	const fromReact = path.join(repoRoot, "packages/rendering/react/package.json");
	const fromVue = path.join(repoRoot, "packages/rendering/vue/package.json");
	const fromYjs = path.join(repoRoot, "packages/crdt/yjs/package.json");
	const fromPlayground = path.join(repoRoot, "playground/package.json");

	addHostTypes(paths, fromReact, "react", "@types/react");
	addHostTypes(paths, fromReact, "react/jsx-runtime", "@types/react", "jsx-runtime.d.ts");
	addHostTypes(paths, fromReact, "react/jsx-dev-runtime", "@types/react", "jsx-dev-runtime.d.ts");
	addHostTypes(paths, fromReact, "react-dom", "@types/react-dom");
	addHostTypes(paths, fromReact, "react-dom/client", "@types/react-dom", "client.d.ts");
	addHostTypes(paths, fromVue, "vue", "vue");
	addHostTypes(paths, fromYjs, "yjs", "yjs");
	addHostTypes(paths, fromPlayground, "y-websocket", "y-websocket");
	return paths;
}

function addHostTypes(paths, fromPackageJson, spec, packageName, fileName) {
	try {
		const req = createRequire(fromPackageJson);
		const packageJsonPath = req.resolve(`${packageName}/package.json`);
		const dir = path.dirname(packageJsonPath);
		if (fileName) {
			const filePath = path.join(dir, fileName);
			if (existsSync(filePath)) {
				paths[spec] = [filePath];
			}
			return;
		}
		const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		const types =
			manifest.types ??
			manifest.typings ??
			manifest.exports?.["."]?.import?.types ??
			manifest.exports?.["."]?.types ??
			"index.d.ts";
		const filePath = path.join(dir, types);
		if (existsSync(filePath)) {
			paths[spec] = [filePath];
		}
	} catch {
		// host package not installed in this workspace checkout
	}
}

export async function typecheckSamples({ samples, packages, repoRoot }) {
	const prepared = [];
	const skipped = [];
	for (const sample of samples) {
		const next = prepareSampleSource(sample);
		if (next.skip) {
			skipped.push({ file: sample.file, index: sample.index, reason: next.skip });
			continue;
		}
		prepared.push({ sample, source: next.source });
	}

	if (prepared.length === 0) {
		return { errors: [], skipped, checked: 0 };
	}

	const cacheDir = path.join(repoRoot, "node_modules", ".cache");
	await fs.mkdir(cacheDir, { recursive: true });
	const tmp = await fs.mkdtemp(path.join(cacheDir, "pen-doc-refs-"));
	try {

		const files = [];
		for (const item of prepared) {
			const name = sampleFilename(item.sample);
			await fs.writeFile(path.join(tmp, name), item.source, "utf8");
			files.push(name);
		}

		const tsconfig = {
			compilerOptions: {
				target: "ES2022",
				lib: ["ES2022", "DOM", "DOM.Iterable"],
				module: "ESNext",
				moduleResolution: "bundler",
				jsx: "react-jsx",
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				isolatedModules: true,
				noUnusedLocals: false,
				noUnusedParameters: false,
				paths: compilerPaths(packages, repoRoot),
			},
			include: files,
		};
		await fs.writeFile(
			path.join(tmp, "tsconfig.json"),
			JSON.stringify(tsconfig, null, 2),
			"utf8",
		);

		const tsc = path.join(repoRoot, "node_modules", ".bin", "tsc");
		const result = spawnSync(tsc, ["--pretty", "false", "-p", tmp], {
			encoding: "utf8",
			cwd: tmp,
		});
		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
		const errors = [];
		if (result.status !== 0) {
			for (const line of output.split("\n")) {
				const match = /^([^\s:(]+)\((\d+),(\d+)\): error TS\d+: (.+)$/.exec(line);
				if (!match) {
					continue;
				}
				const fileName = match[1];
				const sample = prepared.find((item) => sampleFilename(item.sample) === fileName)
					?.sample;
				errors.push({
					file: sample?.file ?? fileName,
					index: sample?.index ?? 0,
					line: Number(match[2]),
					message: match[4],
				});
			}
			if (errors.length === 0 && output.length > 0) {
				errors.push({
					file: "(tsc)",
					index: 0,
					line: 0,
					message: output.slice(0, 2000),
				});
			}
		}
		return { errors, skipped, checked: prepared.length };
	} finally {
		await fs.rm(tmp, { recursive: true, force: true });
	}
}

export function formatReport({
	missingRefs,
	typecheck,
	artifacts,
	coverage = { missing: [], unlabeled: [] },
	specVersions = { stale: [], unmapped: [] },
	outdatedDist = [],
}) {
	const lines = ["DOC1/DOC2 documentation truth"];
	lines.push("");
	lines.push(`outdated dist ${outdatedDist.length}`);
	lines.push("");

	if (artifacts.length > 0) {
		lines.push("FAIL missing built type artifacts (run pnpm build):");
		for (const hit of artifacts) {
			lines.push(`  ${hit.package}  ${hit.path}`);
		}
		lines.push("");
	}

	if (missingRefs.length > 0) {
		lines.push("FAIL package or version references that do not exist:");
		for (const hit of missingRefs) {
			lines.push(`  ${hit.file}: ${hit.ref}`);
			lines.push(`    ${hit.reason}`);
		}
		lines.push("");
	} else {
		lines.push("OK: every @input/pen-* name and version resolves in the workspace.");
	}

	lines.push("");
	if (coverage.missing.length > 0) {
		lines.push(
			"FAIL published packages missing from the root README package table (DOC1/SF7):",
		);
		for (const name of coverage.missing) {
			lines.push(`  ${name}`);
		}
	}
	if (coverage.unlabeled.length > 0) {
		lines.push(
			"FAIL companion packages missing the `Companion:` label in their table row (DOC1/SF7):",
		);
		for (const name of coverage.unlabeled) {
			lines.push(`  ${name}`);
		}
	}
	if (coverage.missing.length === 0 && coverage.unlabeled.length === 0) {
		lines.push(
			"OK: every published package has a root README table row, companions labelled.",
		);
	}

	lines.push("");
	if (specVersions.stale.length > 0) {
		lines.push(
			"FAIL package specs claim a version the manifest contradicts (API7/DOC1):",
		);
		for (const hit of specVersions.stale) {
			lines.push(`  ${hit.file}  claims ${hit.claimed}, ${hit.name} is ${hit.actual}`);
		}
	}
	if (specVersions.unmapped.length > 0) {
		lines.push(
			"FAIL package specs state a version with no resolvable workspace path (API7/DOC1):",
		);
		for (const hit of specVersions.unmapped) {
			lines.push(`  ${hit.file}  claims ${hit.claimed}`);
		}
	}
	if (specVersions.stale.length === 0 && specVersions.unmapped.length === 0) {
		lines.push("OK: every package spec's stated version matches its manifest.");
	}

	lines.push("");
	lines.push(
		`samples checked ${typecheck.checked}  skipped ${typecheck.skipped.length}  errors ${typecheck.errors.length}`,
	);
	if (typecheck.errors.length > 0) {
		lines.push(`FAIL ${typecheck.errors.length} sample type error(s):`);
		for (const error of typecheck.errors) {
			const loc =
				error.index > 0
					? `${error.file} sample ${error.index}:${error.line}`
					: `${error.file}:${error.line}`;
			lines.push(`  ${loc}`);
			lines.push(`    ${error.message}`);
		}
	} else {
		lines.push("OK: every extracted sample type-checks.");
	}

	appendOutdatedDistLines(lines, outdatedDist);
	const result = {
		missingRefs,
		typecheck,
		artifacts,
		coverage,
		specVersions,
		outdatedDist,
	};
	if (!hasFailures(result) && hasInconclusive(result)) {
		lines.push("");
		lines.push(
			`INCONCLUSIVE: samples type-check against the .d.ts, but ${outdatedDist.length} package(s) have type-input source newer than dist. That is not a pass.`,
		);
	} else if (hasFailures(result) && hasInconclusive(result)) {
		lines.push("");
		lines.push(
			`INCONCLUSIVE: ${outdatedDist.length} package(s) have type-input source newer than dist; sample results may be incomplete until those rebuild.`,
		);
	}

	return lines.join("\n");
}

export function hasFailures({
	missingRefs,
	typecheck,
	artifacts,
	coverage = { missing: [], unlabeled: [] },
	specVersions = { stale: [], unmapped: [] },
}) {
	return (
		artifacts.length > 0 ||
		missingRefs.length > 0 ||
		coverage.missing.length > 0 ||
		coverage.unlabeled.length > 0 ||
		specVersions.stale.length > 0 ||
		specVersions.unmapped.length > 0 ||
		typecheck.errors.length > 0
	);
}

export function hasInconclusive({ outdatedDist = [] }) {
	return outdatedDist.length > 0;
}

function parseArgs(argv) {
	let repoRoot = DEFAULT_REPO_ROOT;
	let selfTestOnly = false;
	let skipTypecheck = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--self-test") {
			selfTestOnly = true;
			continue;
		}
		if (arg === "--skip-typecheck") {
			skipTypecheck = true;
			continue;
		}
		if (arg === "--repo-root") {
			repoRoot = path.resolve(argv[i + 1] ?? "");
			i += 1;
			continue;
		}
		throw new Error(`Unknown flag: ${arg}`);
	}
	return { repoRoot, selfTestOnly, skipTypecheck };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	runSelfTests();
	await runFreshnessSelfTests();
	await runExampleSourceSelfTests();
	console.log(
		"DOC refs self-test ok (missing package, wrong version, missing subpath, undocumented published package, stale spec version claim, and missing example source fail closed)",
	);
	if (args.selfTestOnly) {
		return;
	}

	const packages = await loadNamedPackages(args.repoRoot);
	const docs = await loadDocFiles(args.repoRoot);
	const refs = [];
	for (const doc of docs) {
		for (const ref of extractPackageRefs(doc.text)) {
			refs.push({ ...ref, file: doc.file });
		}
	}

	const missingRefs = evaluateRefs({ refs, packages });
	const coverage = evaluateReadmeCoverage({
		readme: docs.find((doc) => doc.file === "README.md")?.text ?? "",
		packages,
	});
	const specVersions = evaluateSpecVersions({
		specs: await loadSpecFiles(args.repoRoot),
		packages,
	});
	const artifacts = await missingTypeArtifacts(packages, args.repoRoot);
	const outdatedDist = await collectOutdatedDist(
		packages
			.filter(
				(pkg) =>
					!pkg.dir.startsWith("examples/") && pkg.manifest.private !== true,
			)
			.map((pkg) => ({
				name: pkg.name,
				dir: path.join(args.repoRoot, pkg.dir),
				packageJson: pkg.manifest,
			})),
	);

	const examples = await loadExampleSources(args.repoRoot);
	const samples = [
		...docs.flatMap((doc) => extractFencedSamples(doc.text, doc.file)),
		...examples.sources,
	];

	const typecheck = args.skipTypecheck
		? { errors: [], skipped: [], checked: 0 }
		: await typecheckSamples({
				samples,
				packages,
				repoRoot: args.repoRoot,
			});

	const result = {
		missingRefs,
		typecheck,
		artifacts,
		coverage,
		specVersions,
		outdatedDist,
	};
	console.log("");
	console.log(formatReport(result));
	if (hasFailures(result) || hasInconclusive(result)) {
		process.exitCode = 1;
	}
	reportMissingExampleSources(examples.missing);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
