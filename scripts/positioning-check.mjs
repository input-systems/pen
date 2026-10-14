#!/usr/bin/env node
/**
 * API8 positioning gate (spec/rules/api.md).
 *
 * LICENSE.md is MIT, copyright Input Systems B.V. Retired source-available /
 * commercial wording must stay in the license decision record. A future
 * "requires a commercial license for production use" in a package
 * README is a legal-accuracy failure, not a style one.
 *
 * Allowlist is specific files, never a directory: a package README
 * dropped under spec/ must still fail.
 *
 * Fails closed on a walker that finds nothing (glob typo / empty root).
 * Self-tests on every run so a checker that cannot fail is visible.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	"dist",
	"coverage",
	".turbo",
	".git",
	"playwright-report",
	"test-results",
]);

/**
 * Required scan landmarks. A walker that returns files but missed the
 * docs tree (wrong root, over-narrow glob) is the same species of bug
 * as finding zero files.
 */
const REQUIRED_FILES = ["LICENSE.md", "README.md", "CONTRIBUTING.md"];
const REQUIRED_PREFIXES = ["spec/", "packages/"];

/**
 * Phrases from the retired source-available license and adjacent
 * license-class names. Each pattern is a claim that Pen is not MIT,
 * not a word that appears in ordinary engineering prose.
 */
const TERMS = [
	{ id: "source-available", re: /source[-\s]available/i },
	{ id: "commercial license", re: /commercial(?:ly)?\s+licen[a-z]*/i },
	{ id: "BUSL / Business Source", re: /business source|\bBUSL\b/i },
	{ id: "dual-license", re: /dual[-\s]licen[a-z]*/i },
	{ id: "non-commercial", re: /non[-\s]commercial/i },
	{ id: "free in/for development", re: /free (?:for|in) development/i },
	{ id: "production use requires", re: /production use requir[a-z]*/i },
	{ id: "production-use restriction", re: /production[-\s]use restriction/i },
	{ id: "requires a commercial", re: /requir(?:es|ed) a commercial/i },
	{ id: "license-enforcement", re: /license[-\s]enforcement/i },
	{ id: "enforcement clause", re: /enforcement clause/i },
	{ id: "not open source", re: /not open[-\s]source/i },
];

/**
 * Decision-record locations only. Reasons are why historical wording
 * is permitted here — not a waiver for current positioning claims.
 */
const ALLOWLIST = {
	"spec/rules/api.md":
		"API8 living decision record: records the retired source-available terms and the MIT relicense",
	"CONTRIBUTING.md":
		"API8: CLA inbound/outbound asymmetry and the retired enforcement-clause decision belong where contributors read them",
};

function toPosix(relPath) {
	return relPath.split(path.sep).join(path.posix.sep);
}

export function collectMarkdownFiles(repoRoot) {
	const files = [];

	function walk(directory) {
		let entries;
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch (error) {
			if (error && typeof error === "object" && error.code === "ENOENT") {
				return;
			}
			throw error;
		}
		for (const entry of entries) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!IGNORE_DIR_NAMES.has(entry.name)) {
					walk(entryPath);
				}
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			if (!MARKDOWN_EXTENSIONS.has(path.extname(entry.name))) {
				continue;
			}
			files.push(entryPath);
		}
	}

	walk(repoRoot);
	files.sort((left, right) => left.localeCompare(right));
	return files;
}

export function extractHits(source, file) {
	const hits = [];
	const lines = source.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		for (const term of TERMS) {
			const match = term.re.exec(line);
			if (match == null) {
				continue;
			}
			hits.push({
				file,
				line: index + 1,
				term: term.id,
				phrase: match[0],
			});
		}
	}
	return hits;
}

export function evaluateHits(hits) {
	const allowed = [];
	const unexpected = [];
	for (const hit of hits) {
		if (Object.hasOwn(ALLOWLIST, hit.file)) {
			allowed.push({ ...hit, reason: ALLOWLIST[hit.file] });
			continue;
		}
		unexpected.push(hit);
	}
	return { allowed, unexpected };
}

export function walkerCoverageError(files, repoRoot) {
	if (files.length === 0) {
		return "positioning-check: scanned 0 markdown files (walker/glob is broken; refusing to pass)";
	}

	const rels = new Set(
		files.map((filePath) => toPosix(path.relative(repoRoot, filePath))),
	);

	const missingFiles = REQUIRED_FILES.filter((rel) => !rels.has(rel));
	if (missingFiles.length > 0) {
		return `positioning-check: walker missed required file(s): ${missingFiles.join(", ")}`;
	}

	const missingPrefixes = REQUIRED_PREFIXES.filter(
		(prefix) => ![...rels].some((rel) => rel.startsWith(prefix)),
	);
	if (missingPrefixes.length > 0) {
		return `positioning-check: walker missed required tree(s): ${missingPrefixes.join(", ")}`;
	}

	return null;
}

export function formatReport({ files, allowed, unexpected }) {
	const lines = [
		"API8 positioning check",
		"",
		`Scanned ${files.length} markdown file(s).`,
		`Allowlisted hits: ${allowed.length}. Unexpected hits: ${unexpected.length}.`,
	];

	if (unexpected.length > 0) {
		lines.push("");
		lines.push(
			"FAIL: retired positioning language outside the license decision record:",
		);
		for (const hit of unexpected) {
			lines.push(`  ${hit.file}:${hit.line}  ${hit.term}`);
			lines.push(`    ${hit.phrase}`);
		}
	} else {
		lines.push("");
		lines.push(
			"OK: retired wording is confined to the API8 decision-record allowlist.",
		);
	}

	return lines.join("\n");
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

export function runSelfTest() {
	const commercial = "This is a commercially licensed product.";
	const sourceAvailable = "This SDK is source-available.";
	const stacked = "requires a commercial license for production use";
	const clean = "Pen is an MIT-licensed SDK. CI enforcement is a quality gate.";

	const dirtyHits = [
		...extractHits(commercial, "packages/core/README.md"),
		...extractHits(sourceAvailable, "README.md"),
	];
	assert(dirtyHits.length === 2, `self-test: expected 2 dirty hits, got ${dirtyHits.length}`);
	assert(
		dirtyHits[0]?.term === "commercial license",
		`self-test: first hit must be commercial license, got ${JSON.stringify(dirtyHits[0])}`,
	);
	assert(
		dirtyHits[1]?.term === "source-available",
		`self-test: second hit must be source-available, got ${JSON.stringify(dirtyHits[1])}`,
	);

	const dirtyEval = evaluateHits(dirtyHits);
	assert(
		dirtyEval.unexpected.length === 2,
		"self-test: unmarked retired wording must fail",
	);

	const stackedHits = extractHits(stacked, "packages/core/README.md");
	assert(
		stackedHits.length >= 2,
		`self-test: stacked phrase must match more than one term, got ${stackedHits.length}`,
	);
	const stackedEval = evaluateHits(stackedHits);
	assert(
		stackedEval.unexpected.length === stackedHits.length,
		"self-test: stacked retired wording in a package README must fail",
	);

	const allowedHits = extractHits(sourceAvailable, "spec/rules/api.md");
	const allowedEval = evaluateHits(allowedHits);
	assert(
		allowedEval.unexpected.length === 0 && allowedEval.allowed.length === 1,
		"self-test: decision-record file must be allowlisted",
	);

	const cleanHits = extractHits(clean, "README.md");
	assert(cleanHits.length === 0, "self-test: MIT prose and 'CI enforcement' must not match");

	const emptyError = walkerCoverageError([], DEFAULT_REPO_ROOT);
	assert(
		emptyError != null && emptyError.includes("0 markdown"),
		"self-test: zero scanned files must fail closed",
	);

	const missedError = walkerCoverageError(
		[path.join(DEFAULT_REPO_ROOT, "CONTRIBUTING.md")],
		DEFAULT_REPO_ROOT,
	);
	assert(
		missedError != null && missedError.includes("LICENSE.md"),
		"self-test: a partial walk must fail closed",
	);
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

function main() {
	runSelfTest();
	console.log("positioning-check self-test: injected retired wording failed the checker.");

	const { repoRoot } = parseArgs(process.argv.slice(2));
	const files = collectMarkdownFiles(repoRoot);
	const coverageError = walkerCoverageError(files, repoRoot);
	if (coverageError != null) {
		console.error(coverageError);
		process.exitCode = 1;
		return;
	}

	const hits = [];
	for (const filePath of files) {
		const rel = toPosix(path.relative(repoRoot, filePath));
		const source = fs.readFileSync(filePath, "utf8");
		hits.push(...extractHits(source, rel));
	}

	const result = evaluateHits(hits);
	const report = formatReport({ files, ...result });
	if (result.unexpected.length > 0) {
		console.error(report);
		process.exitCode = 1;
		return;
	}
	console.log(report);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
	try {
		main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
