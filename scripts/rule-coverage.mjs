#!/usr/bin/env node
/**
 * Rule coverage gate (CH11, spec/rules/reliability.md).
 *
 * reliability.md says every normative rule ID is claimed by a test carrying
 * that ID in its name. That sentence had no working instrument: the old
 * checker read a `spec-v2` tree that no longer exists and was wired to
 * nothing, so a claim could disappear with no signal.
 *
 * Inventory: every `- ID.` bullet under spec/rules, spec/charter, and
 * spec/packages, skipping `## Retired` / `## Dropped` sections and bullets
 * whose text starts with RETIRED. Keys are `<doc>#<ID>` (doc = path under
 * spec/ without `.md`), because two documents may share a letter family —
 * `R1`–`R3` exist in both selection.md and facets.md.
 *
 * Claims: the first string argument of `describe`, `it`, `test`, or
 * `scenario` calls in every `*.test.*` / `*.spec.*` file in the workspace.
 * `.skip`, `.todo`, and `.fixme` do not claim (CH3). File names do not claim;
 * reliability.md asks for the ID in the test's name, so file-name matches are
 * printed as hints only. An ID that more than one document defines resolves
 * by a `[<doc basename>]` qualifier in the title, else by the test's path
 * through scripts/rule-coverage-config.json.
 *
 * The committed scope (scripts/rule-coverage-claimed.txt) is a ratchet:
 *   F1  a scope entry with no claiming test fails;
 *   F2  a scope entry that names no live rule fails (I15);
 *   F3  a claim the scope does not record fails — run with `--write`;
 *   F4  an empty spec walk, an empty test walk, or an unconfigured ambiguous
 *       family fails closed (CH10).
 * Unclaimed rules are reported by name and do not fail.
 *
 *   node scripts/rule-coverage.mjs             check
 *   node scripts/rule-coverage.mjs --write     record new claims in the scope
 *
 * Tests: scripts/__tests__/ruleCoverage.test.mjs (`node --test`), run by the
 * gate before the check.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const SPEC_SUBDIRS = ["rules", "charter", "packages"];
const SCOPE_FILE = "scripts/rule-coverage-claimed.txt";
const CONFIG_FILE = "scripts/rule-coverage-config.json";

const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	"dist",
	".git",
	".turbo",
	"coverage",
	"playwright-report",
	".generated",
	".pnpm-store",
	// Agent worktrees and tool state: other checkouts' tests, not this one's.
	".claude",
]);
const IGNORE_DIR_RE = /^test-results/;

const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const RULE_BULLET_RE = /^-\s+\*{0,2}([A-Z]+)(\d+)(?:\*{0,2}\.|\.\*{0,2})\s+(.*)$/;
const RETIRED_SECTION_RE = /^##\s+(?:Retired|Dropped)\b/i;
const RETIRED_TEXT_RE = /^(?:\*{0,2})(?:RETIRED|Retired\.)/;
const TITLE_ID_RE = /(?<![A-Za-z0-9])([A-Z]+)(\d+)(?![0-9])/g;
const NON_CLAIMING_MODIFIERS = new Set(["skip", "todo", "fixme"]);
// `.skip` / `.each([...])` / `.describe` … between the callee and its call.
// Only `each` and `for` take arguments, which may nest one level of parens.
const MODIFIER_CHAIN_RE =
	/(?:\s*\.\s*(?:(?:each|for)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|[A-Za-z_$][\w$]*))*/y;
const MODIFIER_NAME_RE = /\.\s*([A-Za-z_$][\w$]*)/g;
const CALL_OPEN_RE = /\s*\(\s*/y;
const QUOTED_RE = /(['"])((?:\\.|(?!\1)[^\\])*)\1/y;
const TEMPLATE_RE = /`((?:\\.|\$\{[^}]*\}|[^`\\])*)`/y;

// ── Inventory ────────────────────────────────────────────────

/**
 * @param {{ doc: string; text: string }[]} docs
 * @returns {Map<string, { doc: string; id: string; line: number }>}
 */
export function inventoryFromDocs(docs) {
	const inventory = new Map();
	for (const { doc, text } of docs) {
		let retiredSection = false;
		text.split(/\r?\n/).forEach((line, index) => {
			retiredSection = line.startsWith("## ")
				? RETIRED_SECTION_RE.test(line)
				: retiredSection;
			const id = retiredSection ? null : liveRuleId(line);
			if (id != null) {
				inventory.set(`${doc}#${id}`, { doc, id, line: index + 1 });
			}
		});
	}
	return inventory;
}

function liveRuleId(line) {
	const match = RULE_BULLET_RE.exec(line);
	return match == null || RETIRED_TEXT_RE.test(match[3])
		? null
		: `${match[1]}${match[2]}`;
}

function isWalkedDirectory(entry) {
	return (
		entry.isDirectory() &&
		!IGNORE_DIR_NAMES.has(entry.name) &&
		!IGNORE_DIR_RE.test(entry.name)
	);
}

function walkFiles(directory, accept) {
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const entryPath = path.join(directory, entry.name);
			if (isWalkedDirectory(entry)) {
				return walkFiles(entryPath, accept);
			}
			return entry.isFile() && accept(entry.name) ? [entryPath] : [];
		});
}

function toPosix(relative) {
	return relative.split(path.sep).join(path.posix.sep);
}

export function readInventory(specRoot) {
	const docs = SPEC_SUBDIRS.flatMap((subdir) => {
		const root = path.join(specRoot, subdir);
		return fs.existsSync(root)
			? walkFiles(root, (name) => name.endsWith(".md"))
			: [];
	}).map((file) => ({
		doc: toPosix(path.relative(specRoot, file)).replace(/\.md$/, ""),
		text: fs.readFileSync(file, "utf8"),
	}));
	return inventoryFromDocs(docs);
}

// ── Test titles ──────────────────────────────────────────────

function execAt(regex, source, index) {
	regex.lastIndex = index;
	return regex.exec(source);
}

function readStringLiteral(source, index) {
	const match =
		execAt(QUOTED_RE, source, index) ?? execAt(TEMPLATE_RE, source, index);
	const raw = (match ?? [""]).at(-1);
	return raw.replace(/\$\{[^}]*\}/g, " ").replace(/\\(.)/g, "$1");
}

function titleAfter(source, calleeEnd) {
	const chain = execAt(MODIFIER_CHAIN_RE, source, calleeEnd);
	const modifiers = [...chain[0].matchAll(MODIFIER_NAME_RE)].map(([, name]) => name);
	const skipped = modifiers.some((name) => NON_CLAIMING_MODIFIERS.has(name));
	const open = execAt(CALL_OPEN_RE, source, chain.index + chain[0].length);
	return skipped || open == null ? null : readStringLiteral(source, CALL_OPEN_RE.lastIndex);
}

/**
 * Returns the static titles of claiming `describe`/`it`/`test`/`scenario`
 * calls. Template-literal interpolations are dropped; skipped and todo
 * calls are not claims.
 */
export function extractTestTitles(source) {
	const calleeRe = /(?<![\w$.'"`])(describe|it|test|scenario)\b/g;
	return [...source.matchAll(calleeRe)]
		.map((match) => titleAfter(source, match.index + match[0].length))
		.filter((title) => title != null && title.length > 0);
}

// ── Claims ───────────────────────────────────────────────────

function docsById(inventory) {
	const byId = new Map();
	for (const { doc, id } of inventory.values()) {
		byId.set(id, [...(byId.get(id) ?? []), doc]);
	}
	return byId;
}

function familyOf(id) {
	return /^[A-Z]+/.exec(id)[0];
}

function qualifiedDoc(docs, title) {
	return docs.find((doc) => title.includes(`[${path.posix.basename(doc)}]`));
}

function pathDoc(docs, prefixesByDoc, file) {
	return docs.find((doc) =>
		(prefixesByDoc?.[doc] ?? []).some((prefix) => file.startsWith(prefix)),
	);
}

function unconfiguredFamily(doc, prefixesByDoc, family) {
	return doc == null && prefixesByDoc == null ? family : null;
}

function resolveAmbiguous({ id, docs, title, file, config }) {
	const family = familyOf(id);
	const prefixesByDoc = config.ambiguous?.[family];
	const doc = qualifiedDoc(docs, title) ?? pathDoc(docs, prefixesByDoc, file);
	return { doc, unconfigured: unconfiguredFamily(doc, prefixesByDoc, family) };
}

function titleIds(title) {
	return [...title.matchAll(TITLE_ID_RE)].map(([, family, number]) => `${family}${number}`);
}

function ambiguousKey({ docs, unconfigured, ...context }) {
	const resolved = resolveAmbiguous({ docs, ...context });
	if (resolved.unconfigured != null) {
		unconfigured.add(resolved.unconfigured);
	}
	return resolved.doc == null ? null : `${resolved.doc}#${context.id}`;
}

function claimKeyFor({ byId, ...context }) {
	const docs = byId.get(context.id) ?? [];
	if (docs.length > 1) {
		return ambiguousKey({ docs, ...context });
	}
	return docs.length === 1 ? `${docs[0]}#${context.id}` : null;
}

function addTo(map, key, value) {
	map.set(key, (map.get(key) ?? new Set()).add(value));
}

/**
 * @param {{ path: string; text: string }[]} files repo-relative posix paths
 * @returns {{ claims: Map<string, Set<string>>; unconfigured: Set<string>; fileHints: Map<string, Set<string>> }}
 */
export function claimsFromFiles(files, inventory, config) {
	const byId = docsById(inventory);
	const claims = new Map();
	const unconfigured = new Set();
	const fileHints = new Map();
	for (const { path: file, text } of files) {
		for (const title of extractTestTitles(text)) {
			const keys = titleIds(title).map((id) =>
				claimKeyFor({ id, title, file, byId, config, unconfigured }),
			);
			keys.filter(Boolean).forEach((key) => addTo(claims, key, file));
		}
		titleIds(path.posix.basename(file).toUpperCase())
			.filter((id) => byId.has(id))
			.forEach((id) => addTo(fileHints, id, file));
	}
	return { claims, unconfigured, fileHints };
}

export function readClaims(repoRoot, inventory, config) {
	const files = walkFiles(repoRoot, (name) => TEST_FILE_RE.test(name)).map(
		(file) => ({
			path: toPosix(path.relative(repoRoot, file)),
			text: fs.readFileSync(file, "utf8"),
		}),
	);
	return { fileCount: files.length, ...claimsFromFiles(files, inventory, config) };
}

// ── Evaluation ───────────────────────────────────────────────

export function parseScope(text) {
	return text
		.split(/\r?\n/)
		.map((line) => line.replace(/#(?![A-Z]).*$/, "").trim())
		.filter((line) => line.length > 0);
}

/**
 * @returns {{ f1: string[]; f2: string[]; f3: string[]; f4: string[]; unclaimed: string[] }}
 */
export function evaluate({ inventory, claims, scope, unconfigured, fileCount }) {
	const scopeSet = new Set(scope);
	const f4 = [
		...(inventory.size === 0 ? ["spec walk found 0 rule bullets"] : []),
		...(fileCount === 0 ? ["test walk found 0 test files"] : []),
		...[...unconfigured].map(
			(family) =>
				`ambiguous family ${family} has no entry in ${CONFIG_FILE}`,
		),
	];
	return {
		f1: scope.filter((key) => inventory.has(key) && !claims.has(key)),
		f2: scope.filter((key) => !inventory.has(key)),
		f3: [...claims.keys()].filter((key) => !scopeSet.has(key)).sort(),
		f4,
		unclaimed: [...inventory.keys()]
			.filter((key) => !claims.has(key))
			.sort(),
	};
}

export function hasFailures(result) {
	return ["f1", "f2", "f3", "f4"].some((key) => result[key].length > 0);
}

const FAILURE_TITLES = {
	f4: "FAIL (F4): the gate cannot check, so it fails closed:",
	f1: "FAIL (F1): scope entries with no claiming test (restore the test or fix the spec):",
	f2: "FAIL (F2): scope entries that name no live rule (I15; remove them with the spec change):",
	f3: "FAIL (F3): claims the scope does not record (run `pnpm coverage:rules --write`):",
};

function groupUnclaimed(unclaimed) {
	const byDoc = new Map();
	for (const key of unclaimed) {
		const [doc, id] = key.split("#");
		byDoc.set(doc, [...(byDoc.get(doc) ?? []), id]);
	}
	return byDoc;
}

function formatUnclaimed(unclaimed, fileHints) {
	const byDoc = groupUnclaimed(unclaimed);
	if (byDoc.size === 0) {
		return [];
	}
	return [
		"",
		"Unclaimed (reported, not failing):",
		...[...byDoc].map(([doc, ids]) => {
			const hinted = ids.filter((id) => fileHints.has(id));
			const hint = hinted.length > 0 ? `  (file-name only: ${hinted.join(", ")})` : "";
			return `  ${doc}: ${ids.join(", ")}${hint}`;
		}),
	];
}

export function formatReport(result, { inventory, claims, fileHints }) {
	const failures = ["f4", "f1", "f2", "f3"]
		.filter((key) => result[key].length > 0)
		.flatMap((key) => ["", FAILURE_TITLES[key], ...result[key].map((entry) => `  ${entry}`)]);
	return [
		"Rule coverage (CH11)",
		"",
		`live rules      ${inventory.size}`,
		`claimed         ${claims.size}`,
		`unclaimed       ${result.unclaimed.length}`,
		...formatUnclaimed(result.unclaimed, fileHints),
		...failures,
		"",
		hasFailures(result) ? "FAIL" : "OK",
	].join("\n");
}

// ── Main ─────────────────────────────────────────────────────

const SCOPE_HEADER =
	"# CH11 claimed scope: <spec doc>#<rule ID>, one per line.\n# Add with `pnpm coverage:rules --write`; remove only with the spec or test change that retires the claim.\n";

function readText(file, fallback) {
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback;
}

function appendScope(scopePath, additions) {
	const existing = readText(scopePath, SCOPE_HEADER);
	const separator = existing.endsWith("\n") ? "" : "\n";
	fs.writeFileSync(scopePath, `${existing}${separator}${additions.join("\n")}\n`);
}

/**
 * Runs the check against a repository. With `write`, records new claims
 * (F3) in the scope before reporting; it never removes an entry.
 */
export function checkRepository({ repoRoot, write = false }) {
	const config = JSON.parse(fs.readFileSync(path.join(repoRoot, CONFIG_FILE), "utf8"));
	const inventory = readInventory(path.join(repoRoot, "spec"));
	const read = readClaims(repoRoot, inventory, config);
	const scopePath = path.join(repoRoot, SCOPE_FILE);
	const scope = parseScope(readText(scopePath, ""));
	const first = evaluate({ inventory, ...read, scope });
	const additions = write && first.f4.length === 0 ? first.f3 : [];
	if (additions.length > 0) {
		appendScope(scopePath, additions);
	}
	const result = evaluate({ inventory, ...read, scope: [...scope, ...additions] });
	return { result, inventory, ...read, recorded: additions.length };
}

const cliArgs = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const unknown = cliArgs.filter((arg) => arg !== "--write");
	if (unknown.length > 0) {
		console.error(`rule-coverage: unknown flag ${unknown[0]}`);
		process.exit(1);
	}
	const report = checkRepository({ repoRoot: DEFAULT_REPO_ROOT, write: cliArgs.includes("--write") });
	if (report.recorded > 0) {
		console.log(`recorded ${report.recorded} new claims`);
	}
	console.log(`test files      ${report.fileCount}`);
	console.log(formatReport(report.result, report));
	process.exitCode = hasFailures(report.result) ? 1 : 0;
}
