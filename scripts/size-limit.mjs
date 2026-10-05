#!/usr/bin/env node
/**
 * API7 bundle budgets (spec/rules/api.md).
 *
 * Weighs each published entry path against `.size-limit.baseline.json` via
 * `fs.stat` (same method that recorded the numbers) — `dist/index.mjs`, or
 * `dist/*.mjs` where code splitting means no single file is the package.
 * Growth above
 * `regressionPercent` fails. A re-record is a re-record, not a waiver:
 * every entry's `note` must account for the bytes, either as a recorded
 * baseline or as a `before → after` change.
 *
 * `_deferred` is documentation only — deferred packages stay in
 * `entries` at their last quiet baseline so they still fail until a
 * quiet re-record lands. Do not drop an over-budget package from
 * `entries` to go green.
 *
 * Needs built `dist` artifacts (`pnpm build`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const BASELINE_NAME = ".size-limit.baseline.json";
const ATTRIBUTED_NOTE_RE = /→|->|\bbaseline\b/i;

/**
 * Re-records dated on or after this day must cite the shipped rule that moved
 * the bytes: `Re-recorded baseline <YYYY-MM-DD> (<rule IDs>; …)`. Older notes
 * predate the convention and stay as written.
 */
export const RULE_CITED_SINCE = "2026-10-02";
const RE_RECORD_RE = /Re-recorded baseline (\d{4}-\d{2}-\d{2})(?: \(([^)]*)\))?/;
const RULE_ID_RE = /\b[A-Z]{1,6}\d+\b/;
/** Program requirement IDs (`W35.R3`, `W8`) are not shipped rule IDs. */
const PROGRAM_ID_RE = /\bW\d+(?:\.[A-Z]\d+)?\b/g;

/**
 * A code-split package ships content-hashed chunk names, so no single file
 * is the package and a hashed name cannot be written into the baseline. An
 * entry path may therefore carry one `*` (`dist/*.mjs`), and the weight is
 * the sum of the matches — the shipped ESM closure. Zero matches records
 * nothing, so the entry reports as missing and fails closed.
 */
export function matchGlobNames(pattern, names) {
	const star = pattern.indexOf("*");
	if (star === -1) {
		return names.filter((name) => name === pattern);
	}
	if (pattern.indexOf("*", star + 1) !== -1) {
		throw new Error(`size-limit: ${pattern} may contain at most one *`);
	}
	const prefix = pattern.slice(0, star);
	const suffix = pattern.slice(star + 1);
	return names.filter(
		(name) =>
			name.length >= prefix.length + suffix.length &&
			name.startsWith(prefix) &&
			name.endsWith(suffix),
	);
}

export function resolveLimitBytes(entry) {
	if (typeof entry.limitBytes === "number") {
		return entry.limitBytes;
	}
	if (typeof entry.baselineBytes === "number") {
		return entry.baselineBytes;
	}
	throw new Error(`${entry.name} needs limitBytes or baselineBytes.`);
}

/**
 * An attributed note either records a baseline or states the byte movement
 * it is accounting for. A note that only says where the number was read
 * from does not attribute the bytes.
 */
export function noteAttributesBytes(note) {
	return typeof note === "string" && ATTRIBUTED_NOTE_RE.test(note);
}

/**
 * API7 / SF6: a re-record dated on or after `RULE_CITED_SINCE` names at least
 * one shipped rule ID in the parenthetical after its date, so the baseline
 * says which rule moved it. The program requirement half (`Wn.Rk`) is checked
 * by review, so this stays valid once those IDs are gone.
 */
export function noteCitesRule(note) {
	const match = RE_RECORD_RE.exec(String(note));
	if (!match || match[1] < RULE_CITED_SINCE) {
		return true;
	}
	return parentheticalNamesRule(match[2]);
}

function parentheticalNamesRule(parenthetical = "") {
	return RULE_ID_RE.test(parenthetical.replace(PROGRAM_ID_RE, ""));
}

export function evaluateSizeLimit({ baseline, stats }) {
	const regressionPercent = baseline.regressionPercent ?? 10;
	const entries = baseline.entries ?? [];
	const deferred = Array.isArray(baseline._deferred?.packages)
		? baseline._deferred.packages
		: [];
	const deferredNames = new Set(deferred.map((entry) => entry.name));

	if (entries.length === 0) {
		return {
			ok: false,
			regressionPercent,
			rows: [],
			missing: [],
			over: [],
			unattributed: [],
			deferred,
			empty: true,
		};
	}

	const rows = [];
	const missing = [];
	const over = [];
	const unattributed = [];

	for (const entry of entries) {
		const bytes = stats[entry.path];
		const limitBytes = resolveLimitBytes(entry);
		const ceiling = Math.floor(limitBytes * (1 + regressionPercent / 100));
		const attributed =
			noteAttributesBytes(entry.note) && noteCitesRule(entry.note);
		const row = {
			name: entry.name,
			path: entry.path,
			bytes: bytes ?? null,
			limitBytes,
			ceiling,
			deferred: deferredNames.has(entry.name),
			attributed,
		};
		rows.push(row);
		if (bytes == null) {
			missing.push(row);
		} else if (bytes > ceiling) {
			over.push(row);
		}
		if (!attributed) {
			unattributed.push(row);
		}
	}

	return {
		ok:
			missing.length === 0 &&
			over.length === 0 &&
			unattributed.length === 0,
		regressionPercent,
		rows,
		missing,
		over,
		unattributed,
		deferred,
		empty: false,
	};
}

export function formatSizeLimit(result) {
	const lines = ["API7 size-limit"];
	lines.push("");
	for (const row of result.rows) {
		const bytes = row.bytes == null ? "missing" : `${row.bytes} B`;
		const deferred = row.deferred ? "  [deferred]" : "";
		lines.push(
			`size-limit: ${row.name} ${bytes} (budget ${row.limitBytes} B, +${result.regressionPercent}% ceiling ${row.ceiling} B)${deferred}`,
		);
	}
	if (result.empty) {
		lines.push("");
		lines.push("FAIL size-limit: baseline has no entries.");
	}
	if (result.missing.length > 0) {
		lines.push("");
		lines.push("FAIL size-limit: missing artifacts (build the package first):");
		for (const row of result.missing) {
			lines.push(`  ${row.name}  ${row.path}`);
		}
	}
	if (result.over.length > 0) {
		lines.push("");
		lines.push(
			`FAIL size-limit: exceeds the +${result.regressionPercent}% ceiling. Re-record with a note accounting for the bytes if the growth is intended; do not drop the entry.`,
		);
		for (const row of result.over) {
			const mark = row.deferred ? " (deferred; mid-edit, not re-recorded)" : "";
			lines.push(
				`  ${row.name}  ${row.bytes} B > ${row.ceiling} B${mark}`,
			);
		}
	}
	if (result.unattributed.length > 0) {
		lines.push("");
		lines.push(
			`FAIL size-limit: note does not account for the bytes it records, or a re-record dated ${RULE_CITED_SINCE} or later cites no shipped rule ID (a re-record without attribution is a waiver):`,
		);
		for (const row of result.unattributed) {
			lines.push(`  ${row.name}`);
		}
	}
	if (result.deferred.length > 0) {
		lines.push("");
		lines.push(
			`deferred re-records (${result.deferred.length}; still checked against the last quiet baseline):`,
		);
		for (const entry of result.deferred) {
			lines.push(`  ${entry.name}  ${entry.reason}`);
		}
	}
	if (result.ok) {
		lines.push("");
		lines.push(
			`OK: ${result.rows.length} packages within +${result.regressionPercent}%; every note accounts for its bytes.`,
		);
	}
	return lines.join("\n");
}

const UNCITED_NOTE = "Re-recorded baseline 2026-10-02. Overlay painter moved in. 90 → 100.";

/** Each case: [expectation, passes]. */
const RULE_CITATION_CASES = [
	[
		"API7: a re-record dated 2026-10-02 or later without a rule ID fails",
		() => {
			const result = evaluateSizeLimit({
				baseline: {
					regressionPercent: 10,
					entries: [
						{ name: "@input/pen-dom", path: "dom/*.mjs", baselineBytes: 100, note: UNCITED_NOTE },
					],
				},
				stats: { "dom/*.mjs": 100 },
			});
			return !result.ok && result.unattributed[0]?.name === "@input/pen-dom";
		},
	],
	[
		"a dated re-record citing a rule ID, an older re-record, and a first baseline pass",
		() =>
			[
				"Re-recorded baseline 2026-10-02 (O1, OV1; W35.R3). Overlay painter moved in. 90 → 100.",
				"Re-recorded baseline 2026-09-22. Predates the convention. 90 → 100.",
				"First baseline.",
			].every(noteCitesRule),
	],
	[
		"a program requirement alone is not a shipped rule ID",
		() => !noteCitesRule("Re-recorded baseline 2026-11-03 (W35.R3). Moved. 1 → 2."),
	],
];

function runRuleCitationSelfTests() {
	for (const [expectation, passes] of RULE_CITATION_CASES) {
		if (!passes()) {
			throw new Error(`self-test: ${expectation}`);
		}
	}
}

export function runSelfTests() {
	const healthy = evaluateSizeLimit({
		baseline: {
			regressionPercent: 10,
			entries: [
				{
					name: "@input/pen-shortcuts",
					path: "packages/extensions/shortcuts/dist/index.mjs",
					baselineBytes: 100,
					note: "keymap facet. 80 → 100.",
				},
			],
		},
		stats: { "packages/extensions/shortcuts/dist/index.mjs": 100 },
	});
	if (!healthy.ok) {
		throw new Error("self-test: attributed in-budget entry must pass");
	}

	const globbed = matchGlobNames("*.mjs", [
		"index.mjs",
		"html.mjs",
		"chunk-EPDWUSBK.mjs",
		"index.cjs",
		"index.d.ts",
	]);
	if (globbed.length !== 3 || globbed.includes("index.cjs")) {
		throw new Error("self-test: glob sums hashed chunks and entries, ESM only");
	}
	if (matchGlobNames("*.mjs", ["index.cjs"]).length !== 0) {
		throw new Error("self-test: a glob matching nothing records nothing");
	}
	if (matchGlobNames("index.mjs", ["index.mjs", "other.mjs"]).length !== 1) {
		throw new Error("self-test: a starless path stays an exact match");
	}
	let rejectedTwoStars = false;
	try {
		matchGlobNames("*.*.mjs", ["a.b.mjs"]);
	} catch {
		rejectedTwoStars = true;
	}
	if (!rejectedTwoStars) {
		throw new Error("self-test: more than one * must fail closed");
	}

	const missingBaseline = evaluateSizeLimit({
		baseline: { regressionPercent: 10, entries: [] },
		stats: {},
	});
	if (missingBaseline.ok || !missingBaseline.empty) {
		throw new Error("self-test: empty entries must fail closed");
	}

	const missingArtifact = evaluateSizeLimit({
		baseline: {
			regressionPercent: 10,
			entries: [
				{
					name: "@input/pen-core",
					path: "packages/core/dist/index.mjs",
					baselineBytes: 100,
					note: "First baseline.",
				},
			],
		},
		stats: {},
	});
	if (
		missingArtifact.ok ||
		missingArtifact.missing[0]?.name !== "@input/pen-core"
	) {
		throw new Error("self-test: missing artifact must fail by name");
	}

	const over = evaluateSizeLimit({
		baseline: {
			regressionPercent: 10,
			entries: [
				{
					name: "@input/pen-ai-tools",
					path: "packages/extensions/ai-tools/dist/index.mjs",
					baselineBytes: 100,
					note: "AIB3 tool authority. 100 → 400.",
				},
			],
		},
		stats: { "packages/extensions/ai-tools/dist/index.mjs": 400 },
	});
	if (over.ok || over.over[0]?.name !== "@input/pen-ai-tools") {
		throw new Error("self-test: over-ceiling must fail by name");
	}

	const waiver = evaluateSizeLimit({
		baseline: {
			regressionPercent: 10,
			entries: [
				{
					name: "@input/pen-types",
					path: "packages/types/dist/index.mjs",
					baselineBytes: 100,
					note: "Measured from packages/types/dist/index.mjs after a local build.",
				},
			],
		},
		stats: { "packages/types/dist/index.mjs": 100 },
	});
	if (waiver.ok || waiver.unattributed[0]?.name !== "@input/pen-types") {
		throw new Error(
			"self-test: an unattributed note must fail (re-record without attribution is a waiver)",
		);
	}

	if (noteAttributesBytes("First baseline.") !== true) {
		throw new Error("self-test: a recorded baseline counts");
	}
	if (noteAttributesBytes("keymap facet. 80 → 100.") !== true) {
		throw new Error("self-test: a stated byte movement counts");
	}
	if (noteAttributesBytes("Measured from dist.") !== false) {
		throw new Error("self-test: unattributed measured-from note fails");
	}
	runRuleCitationSelfTests();
}

function parseArgs(argv) {
	let repoRoot = DEFAULT_REPO_ROOT;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--repo-root") {
			repoRoot = path.resolve(argv[i + 1] ?? "");
			i += 1;
			continue;
		}
		throw new Error(`Unknown flag: ${arg}`);
	}
	return { repoRoot };
}

async function loadBaseline(repoRoot) {
	const baselinePath = path.join(repoRoot, BASELINE_NAME);
	try {
		return JSON.parse(await fs.readFile(baselinePath, "utf8"));
	} catch (error) {
		if (error && error.code === "ENOENT") {
			console.error(`size-limit: missing ${BASELINE_NAME}`);
			process.exitCode = 1;
			return null;
		}
		throw error;
	}
}

async function measureEntryBytes(repoRoot, entryPath) {
	const absolute = path.join(repoRoot, entryPath);
	if (!entryPath.includes("*")) {
		return (await fs.stat(absolute)).size;
	}
	const directory = path.dirname(absolute);
	const matched = matchGlobNames(
		path.basename(entryPath),
		await fs.readdir(directory),
	);
	if (matched.length === 0) {
		return null;
	}
	let total = 0;
	for (const name of matched) {
		total += (await fs.stat(path.join(directory, name))).size;
	}
	return total;
}

async function collectStats(repoRoot, entries) {
	const stats = {};
	for (const entry of entries) {
		try {
			const bytes = await measureEntryBytes(repoRoot, entry.path);
			if (bytes != null) {
				stats[entry.path] = bytes;
			}
		} catch (error) {
			if (error && error.code === "ENOENT") {
				continue;
			}
			throw error;
		}
	}
	return stats;
}

async function main() {
	runSelfTests();
	console.log("API7 size-limit self-test ok");
	console.log(
		"  red-proof: missing artifact, over-ceiling, empty entries, unattributed note, and a dated re-record without a rule ID fail closed",
	);

	const args = parseArgs(process.argv.slice(2));
	const baseline = await loadBaseline(args.repoRoot);
	if (baseline == null) {
		return;
	}
	const stats = await collectStats(args.repoRoot, baseline.entries ?? []);
	const result = evaluateSizeLimit({ baseline, stats });
	console.log("");
	console.log(formatSizeLimit(result));
	if (!result.ok) {
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
