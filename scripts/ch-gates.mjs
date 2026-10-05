import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// CH1–CH6 grep gates (spec/rules/reliability.md). CH2 is a host check
// only — the blocking ESLint pass already runs in .github/workflows/ci.yml.
// CH8/CH9 are owned by bench.yml / flake.yml and are linked, not re-run.

let repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const IGNORE_DIR_NAMES = new Set([
	"node_modules",
	"dist",
	"coverage",
	".turbo",
	".git",
	"playwright-report",
	"test-results",
]);

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const TEST_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);

const TRACKED_ISSUE_RE =
	/#\d+\b|[A-Z][A-Z0-9]+-\d+\b|\bF\d{1,3}\b|\b(?:A|N|P|R|SM|D|K|B|ST|T|C|O|S|SCH|G|OV|DIR|BR|M|RI|I|SEC|AX|API|CH|HOST|LOC|DOC|DUR|COL|AIB|IOP|SCALE)\d{1,2}\b|https?:\/\/github\.com\/[^\s)]+\/issues\/\d+/;

const SKIP_CALL_RE =
	/\b(?:describe|it|test)(?:\.describe)?\.(skip|todo|skipIf)\s*\(/g;
const NOCHECK_RE = /(?:^|\n)\s*(?:\/\/|\/\*)\s*@ts-nocheck\b/;
const EXPECT_ERROR_RE = /@ts-expect-error\b/g;
const THIS_ANY_RE = /\bthis\s*:\s*any\b/g;
const CONSOLE_RE = /\bconsole\.(log|warn|error|info|debug)\s*\(/g;

const CONSOLE_SINK_PATHS = new Set([
	"packages/core/src/editor/events.ts",
	"packages/extensions/ai/src/autocomplete/autocompleteDebug.ts",
]);

const PACKAGE_SLOT_SKIP = new Set([
	"src",
	"dist",
	"node_modules",
	"coverage",
	".turbo",
	"__tests__",
	".git",
]);

const GATES = {
	ch1: runCh1,
	ch2: runCh2,
	ch3: runCh3,
	ch4: runCh4,
	ch5: runCh5,
	ch6: runCh6,
	ch8: runCh8,
	ch9: runCh9,
};

const parsedArgs = parseArgs(process.argv.slice(2));
repoRoot = parsedArgs.repoRoot;
const selected = parsedArgs.selected;
const results = [];

for (const id of selected) {
	results.push(await GATES[id]());
}

for (const result of results) {
	printResult(result);
}

const failed = results
	.filter((result) => result.status === "fail")
	.map((result) => result.id);
const warned = results
	.filter((result) => result.status === "warn")
	.map((result) => result.id);
const passed = results
	.filter((result) => result.status === "pass")
	.map((result) => result.id);
console.log(
	`\n---\n${[
		failed.length ? `FAIL ${failed.join(" ")}` : null,
		warned.length ? `WARN ${warned.join(" ")}` : null,
		passed.length ? `PASS ${passed.join(" ")}` : null,
	]
		.filter(Boolean)
		.join(" | ")}`,
);

if (failed.length > 0) {
	process.exitCode = 1;
}

function parseGateIds(gateArg) {
	if (!gateArg || gateArg.startsWith("--")) {
		return ["ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch8", "ch9"];
	}
	const ids = gateArg
		.split(",")
		.map((id) => id.trim().toLowerCase())
		.filter(Boolean);
	for (const id of ids) {
		if (!(id in GATES)) {
			throw new Error(
				`Unknown CH gate "${id}". Expected one of: ${Object.keys(GATES).join(", ")}`,
			);
		}
	}
	return ids;
}

function parseArgs(argv) {
	let selected = null;
	let root = repoRoot;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--repo-root") {
			root = path.resolve(argv[i + 1] ?? "");
			i += 1;
			continue;
		}
		if (arg === "--gate") {
			selected = parseGateIds(argv[i + 1]);
			i += 1;
			continue;
		}
		if (arg.startsWith("--gate=")) {
			selected = parseGateIds(arg.slice("--gate=".length));
			continue;
		}
		throw new Error(`Unknown flag: ${arg}`);
	}
	return {
		selected: selected ?? parseGateIds(null),
		repoRoot: root,
	};
}

async function runCh1() {
	const allowlistPath = path.join(
		repoRoot,
		"scripts/ch-nocheck-allowlist.txt",
	);
	const allowed = new Set(await readAllowlist(allowlistPath));
	const files = await walkFiles(
		path.join(repoRoot, "packages"),
		TS_EXTENSIONS,
	);
	files.push(
		...(await walkFiles(path.join(repoRoot, "playground"), TS_EXTENSIONS)),
		...(await walkFiles(path.join(repoRoot, "internal"), TS_EXTENSIONS)),
	);
	if (files.length === 0) {
		return {
			id: "CH1",
			title: "@ts-nocheck / @ts-expect-error",
			status: "fail",
			details: [
				"cannot check: packages+playground+internal *.ts/*.tsx walk matched 0 files",
			],
		};
	}

	const nocheckFiles = [];
	const uncommentedExpectError = [];

	for (const filePath of files) {
		const source = await fs.readFile(filePath, "utf8");
		const rel = toPosix(filePath);
		if (NOCHECK_RE.test(source)) {
			nocheckFiles.push(rel);
		}
		uncommentedExpectError.push(
			...findUncommentedExpectErrors(source, rel),
		);
	}

	const extra = nocheckFiles.filter((rel) => !allowed.has(rel)).sort();
	const stale = [...allowed]
		.filter((rel) => !nocheckFiles.includes(rel))
		.sort();
	const remaining = nocheckFiles.filter((rel) => allowed.has(rel)).sort();

	const details = [
		`population: ${files.length} files (packages+playground+internal *.ts/*.tsx)`,
	];
	if (
		remaining.length === 0 &&
		extra.length === 0 &&
		stale.length === 0 &&
		uncommentedExpectError.length === 0
	) {
		details.push(
			"zero @ts-nocheck; allowlist empty; no bare @ts-expect-error",
		);
	}
	if (remaining.length > 0) {
		details.push(
			`WARN remaining allowlisted @ts-nocheck: ${remaining.length} (H.2 shrinks scripts/ch-nocheck-allowlist.txt)`,
		);
	}
	if (extra.length > 0) {
		details.push("FAIL new @ts-nocheck files not on the allowlist:");
		for (const rel of extra) {
			details.push(`  ${rel}`);
		}
	}
	if (stale.length > 0) {
		details.push(
			"FAIL allowlist entries that no longer have @ts-nocheck (remove them):",
		);
		for (const rel of stale) {
			details.push(`  ${rel}`);
		}
	}
	if (uncommentedExpectError.length > 0) {
		details.push(
			"FAIL @ts-expect-error without an adjacent tracked-issue comment:",
		);
		for (const hit of uncommentedExpectError) {
			details.push(`  ${hit}`);
		}
	}

	const failed =
		extra.length > 0 ||
		stale.length > 0 ||
		uncommentedExpectError.length > 0;
	return {
		id: "CH1",
		title: "@ts-nocheck / @ts-expect-error",
		status: failed ? "fail" : remaining.length > 0 ? "warn" : "pass",
		details,
	};
}

async function runCh2() {
	const configPath = path.join(repoRoot, "eslint.config.mjs");
	const packageJson = JSON.parse(
		await fs.readFile(path.join(repoRoot, "package.json"), "utf8"),
	);
	const details = [];
	let failed = false;

	if (!(await pathExists(configPath))) {
		details.push("FAIL missing eslint.config.mjs (CH2 host)");
		failed = true;
	}
	// CH2 is about the shape of the pass, not the exact string: one repo-wide
	// `eslint .` rather than a task-runner fan-out. Trailing flags are allowed
	// because `--max-warnings` tightens this gate instead of narrowing it.
	if (
		!/^eslint\s+\.(\s|$)/.test(packageJson.scripts?.["lint:eslint"] ?? "")
	) {
		details.push(
			"FAIL root lint:eslint is not a repo-wide `eslint .` pass",
		);
		failed = true;
	}
	if (
		packageJson.scripts?.lint &&
		!String(packageJson.scripts.lint).includes("lint:eslint")
	) {
		details.push("FAIL root lint script does not invoke lint:eslint");
		failed = true;
	}

	details.push(
		"ESLint is already a blocking step in .github/workflows/ci.yml (validate → Lint repository surfaces) and release.yml. Not re-run here — a second install+lint pass is not cheap.",
	);

	return {
		id: "CH2",
		title: "ESLint host",
		status: failed ? "fail" : "pass",
		details,
	};
}

async function runCh3() {
	const testRoots = ["packages", "playground", "internal"].map((dir) =>
		path.join(repoRoot, dir),
	);
	const violations = [];

	const testFiles = [];
	for (const root of testRoots) {
		const files = (await walkFiles(root, TEST_EXTENSIONS)).filter(
			isTestFile,
		);
		testFiles.push(...files);
		for (const filePath of files) {
			const source = await fs.readFile(filePath, "utf8");
			violations.push(...findSkipViolations(source, toPosix(filePath)));
		}
	}
	if (testFiles.length === 0) {
		return {
			id: "CH3",
			title: "skip-hygiene",
			status: "fail",
			details: [
				"cannot check: packages+playground+internal test walk matched 0 files",
			],
		};
	}

	const details = [
		`population: ${testFiles.length} files (packages+playground+internal tests)`,
		...(violations.length === 0
			? [
					"no skipped/todo tests missing a body or a tracked-issue comment",
				]
			: violations.map((hit) => `FAIL ${hit}`)),
	];

	return {
		id: "CH3",
		title: "skip-hygiene",
		status: violations.length > 0 ? "fail" : "pass",
		details,
	};
}

async function runCh4() {
	const files = await walkFiles(
		path.join(repoRoot, "packages"),
		TS_EXTENSIONS,
	);
	if (files.length === 0) {
		return {
			id: "CH4",
			title: "this: any",
			status: "fail",
			details: ["cannot check: packages *.ts/*.tsx walk matched 0 files"],
		};
	}
	const hits = [];

	for (const filePath of files) {
		const source = await fs.readFile(filePath, "utf8");
		const rel = toPosix(filePath);
		for (const match of source.matchAll(THIS_ANY_RE)) {
			hits.push(`${rel}:${offsetToLine(source, match.index)}`);
		}
	}

	const details =
		hits.length === 0
			? [
					`population: ${files.length} files (packages *.ts/*.tsx)`,
					"zero `this: any` signatures",
				]
			: [
					`population: ${files.length} files (packages *.ts/*.tsx)`,
					`FAIL ${hits.length} this: any signature(s) — H.2 deletes these with the mixin reassembly:`,
					...hits.map((hit) => `  ${hit}`),
				];

	return {
		id: "CH4",
		title: "this: any",
		status: hits.length > 0 ? "fail" : "pass",
		details,
	};
}

async function runCh5() {
	const files = (
		await walkFiles(
			path.join(repoRoot, "packages"),
			new Set([".ts", ".tsx"]),
		)
	).filter(
		(filePath) =>
			!isTestFile(filePath) && !isConsoleAllowed(toPosix(filePath)),
	);
	if (files.length === 0) {
		return {
			id: "CH5",
			title: "console.*",
			status: "fail",
			details: [
				"cannot check: packages runtime *.ts/*.tsx walk matched 0 files",
			],
		};
	}
	const hits = [];

	for (const filePath of files) {
		const source = await fs.readFile(filePath, "utf8");
		const rel = toPosix(filePath);
		for (const match of source.matchAll(CONSOLE_RE)) {
			hits.push(
				`${rel}:${offsetToLine(source, match.index)} console.${match[1]}`,
			);
		}
	}

	const details =
		hits.length === 0
			? [
					`population: ${files.length} files (packages runtime *.ts/*.tsx)`,
					"no runtime console.* outside sink/debug modules",
				]
			: [
					`population: ${files.length} files (packages runtime *.ts/*.tsx)`,
					`FAIL ${hits.length} console.* call(s) outside sink/debug modules (H.4 routes these through diagnostic):`,
					...hits.map((hit) => `  ${hit}`),
				];

	return {
		id: "CH5",
		title: "console",
		status: hits.length > 0 ? "fail" : "pass",
		details,
	};
}

async function collectWorkspacePackageRels(packagesRoot) {
	const slots = [];
	const emptyGroups = [];

	async function visit(abs, rel, insidePackage) {
		let entries;
		try {
			entries = await fs.readdir(abs, { withFileTypes: true });
		} catch {
			return 0;
		}
		const hasManifest = await pathExists(path.join(abs, "package.json"));
		if (hasManifest) {
			slots.push(rel);
		}
		const childInsidePackage = insidePackage || hasManifest;
		let descendantSlots = 0;
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			if (
				IGNORE_DIR_NAMES.has(entry.name) ||
				PACKAGE_SLOT_SKIP.has(entry.name)
			) {
				continue;
			}
			descendantSlots += await visit(
				path.join(abs, entry.name),
				path.posix.join(rel, entry.name),
				childInsidePackage,
			);
		}
		if (
			!hasManifest &&
			!insidePackage &&
			descendantSlots === 0 &&
			rel !== "packages"
		) {
			emptyGroups.push(rel);
		}
		return (hasManifest ? 1 : 0) + descendantSlots;
	}

	await visit(packagesRoot, "packages", false);
	slots.sort();
	emptyGroups.sort();
	return { slots, emptyGroups };
}

async function runCh6() {
	const packagesRoot = path.join(repoRoot, "packages");
	if (!(await pathExists(packagesRoot))) {
		return {
			id: "CH6",
			title: "orphan packages",
			status: "fail",
			details: ["cannot check: packages/ is absent"],
		};
	}

	const { slots, emptyGroups } =
		await collectWorkspacePackageRels(packagesRoot);
	if (slots.length === 0) {
		return {
			id: "CH6",
			title: "orphan packages",
			status: "fail",
			details: [
				"cannot check: packages/** recursive walk matched 0 package slots",
			],
		};
	}

	const orphans = [];
	for (const rel of slots) {
		orphans.push(...(await inspectPackageDir(rel)));
	}
	for (const group of emptyGroups) {
		orphans.push(
			`${group} is not a workspace grouping with package slots (manifest + sources)`,
		);
	}

	const details = [
		`population: ${slots.length} workspace package slots (packages/** recursive)`,
		...(orphans.length === 0
			? ["every packages/** workspace dir has a manifest and sources"]
			: orphans.map((hit) => `FAIL ${hit}`)),
	];

	return {
		id: "CH6",
		title: "orphan packages",
		status: orphans.length > 0 ? "fail" : "pass",
		details,
	};
}

async function runCh8() {
	const workflowRel = ".github/workflows/bench.yml";
	const present = await pathExists(path.join(repoRoot, workflowRel));
	return {
		id: "CH8",
		title: "perf job",
		status: present ? "pass" : "fail",
		details: [
			present
				? `owned by ${workflowRel} (serial @input/pen-bench job). Not re-implemented here.`
				: `FAIL missing ${workflowRel} (H.7)`,
		],
	};
}

async function runCh9() {
	const workflowRel = ".github/workflows/flake.yml";
	const present = await pathExists(path.join(repoRoot, workflowRel));
	return {
		id: "CH9",
		title: "flake job",
		status: present ? "pass" : "fail",
		details: [
			present
				? `owned by ${workflowRel} (scheduled ten-run determinism). Not re-implemented here.`
				: `FAIL missing ${workflowRel} (H.8)`,
		],
	};
}

async function inspectPackageDir(rel) {
	const packageDir = path.join(repoRoot, rel);
	const manifestPath = path.join(packageDir, "package.json");
	const problems = [];

	if (!(await pathExists(manifestPath))) {
		const huskBits = [];
		if (await isDirectory(path.join(packageDir, "dist"))) {
			huskBits.push("dist/");
		}
		if (await isDirectory(path.join(packageDir, "node_modules"))) {
			huskBits.push("node_modules/");
		}
		problems.push(
			huskBits.length > 0
				? `${rel} has ${huskBits.join(" + ")} but no package.json (husk)`
				: `${rel} is a workspace package slot without package.json`,
		);
		return problems;
	}

	if (!(await packageHasSources(packageDir))) {
		problems.push(`${rel} has a manifest but no sources`);
	}
	return problems;
}

async function packageHasSources(packageDir) {
	const srcDir = path.join(packageDir, "src");
	if (await isDirectory(srcDir)) {
		const sources = await walkFiles(srcDir, SOURCE_EXTENSIONS);
		return sources.length > 0;
	}
	const entries = await fs.readdir(packageDir);
	return entries.some((name) => SOURCE_EXTENSIONS.has(path.extname(name)));
}

function isConsoleAllowed(rel) {
	if (CONSOLE_SINK_PATHS.has(rel)) {
		return true;
	}
	if (rel.startsWith("packages/tooling/bench/")) {
		return true;
	}
	const base = path.posix.basename(rel);
	// Vitest config and setup modules run in the runner process, not in an editor
	// session. CH5's rationale is that runtime console calls should go through the
	// diagnostic channel; a test-runner config has no editor to emit one.
	// The fuzz seed also has to reach the nightly job log.
	if (/^vitest\..*\.tsx?$/i.test(base)) {
		return true;
	}
	// Same rationale, Playwright's directory convention instead of Vitest's.
	// isTestFile knows `__tests__/` but not the conformance test roots, which
	// playwright.config.ts declares as testMatch scenarios/**/*.spec.ts and
	// suites/**/*.spec.ts. A module colocated there runs in the Playwright
	// runner process and has no editor to emit a diagnostic on; its console
	// output is the CI log a human reads when a browser assertion flakes.
	// Narrow on purpose: this admits the non-spec helper modules under those
	// roots, two of which log (suites/bidi/helpers.ts and suites/specHelpers.ts
	// logLoad). Neither is a sink and must not be listed as one.
	if (
		rel.startsWith("packages/tooling/conformance/suites/") ||
		rel.startsWith("packages/tooling/conformance/scenarios/")
	) {
		return true;
	}
	return /debug\.tsx?$/i.test(base) || /sink\.tsx?$/i.test(base);
}

function isTestFile(filePath) {
	const rel = toPosix(filePath);
	if (rel.includes("/__tests__/")) {
		return true;
	}
	return /\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/.test(rel);
}

function findSkipViolations(source, rel) {
	const violations = [];
	SKIP_CALL_RE.lastIndex = 0;
	let match;
	while ((match = SKIP_CALL_RE.exec(source))) {
		const callEnd = findBalancedEnd(
			source,
			match.index + match[0].length - 1,
		);
		if (callEnd < 0) {
			continue;
		}
		const call = source.slice(match.index, callEnd);
		if (isConditionalSkip(call)) {
			continue;
		}
		const line = offsetToLine(source, match.index);
		const comment = `${leadingComments(source, match.index)}\n${trailingComment(source, callEnd)}`;
		const missing = [];
		if (isEmptySkipBody(call, match[1])) {
			missing.push("empty body");
		}
		if (!TRACKED_ISSUE_RE.test(comment)) {
			missing.push("no tracked-issue comment");
		}
		if (missing.length > 0) {
			violations.push(
				`${rel}:${line} ${match[0].trim()} — ${missing.join(", ")}`,
			);
		}
	}
	return violations;
}

function isConditionalSkip(call) {
	const open = call.indexOf("(");
	const close = call.lastIndexOf(")");
	if (open < 0 || close <= open) {
		return false;
	}
	const args = call.slice(open + 1, close).trim();
	// A skipped test names itself first; a runtime filter leads with the
	// condition, which Playwright also accepts as a predicate function.
	return args.length > 0 && !/^[`'"]/.test(args);
}

function isEmptySkipBody(call, kind) {
	if (kind === "todo" && !/=>|function/.test(call)) {
		return true;
	}
	const block = lastFunctionBlock(call);
	if (block == null) {
		return !/=>/.test(call);
	}
	const stripped = block
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "")
		.trim();
	return stripped.length === 0;
}

function lastFunctionBlock(call) {
	const arrow = call.lastIndexOf("=>");
	const fn = call.lastIndexOf("function");
	const startKeyword = Math.max(arrow, fn);
	if (startKeyword < 0) {
		return null;
	}
	const brace = call.indexOf("{", startKeyword);
	if (brace < 0) {
		return null;
	}
	const end = findBalancedEnd(call, brace);
	if (end < 0) {
		return null;
	}
	return call.slice(brace + 1, end - 1);
}

function findUncommentedExpectErrors(source, rel) {
	const hits = [];
	EXPECT_ERROR_RE.lastIndex = 0;
	let match;
	while ((match = EXPECT_ERROR_RE.exec(source))) {
		const lineStart = source.lastIndexOf("\n", match.index) + 1;
		const lineEnd = source.indexOf("\n", match.index);
		const line = source.slice(
			lineStart,
			lineEnd === -1 ? source.length : lineEnd,
		);
		const prevLine = previousNonEmptyLine(source, lineStart);
		const nextLine = nextNonEmptyLine(
			source,
			lineEnd === -1 ? source.length : lineEnd,
		);
		const adjacent = `${prevLine}\n${line}\n${nextLine}`;
		if (!TRACKED_ISSUE_RE.test(adjacent)) {
			hits.push(`${rel}:${offsetToLine(source, match.index)}`);
		}
	}
	return hits;
}

function leadingComments(source, index) {
	const lines = source.slice(0, index).split("\n");
	const collected = [];
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const trimmed = lines[i].trim();
		if (trimmed === "") {
			if (collected.length > 0) {
				break;
			}
			continue;
		}
		if (
			trimmed.startsWith("//") ||
			trimmed.startsWith("/*") ||
			trimmed.startsWith("*") ||
			trimmed.endsWith("*/")
		) {
			collected.unshift(lines[i]);
			continue;
		}
		break;
	}
	return collected.join("\n");
}

function trailingComment(source, index) {
	const lineEnd = source.indexOf("\n", index);
	const rest = source.slice(index, lineEnd === -1 ? source.length : lineEnd);
	const comment = rest.match(/\/\/.*$/);
	return comment ? comment[0] : "";
}

function previousNonEmptyLine(source, lineStart) {
	const before = source.slice(0, lineStart).replace(/\s+$/, "");
	const prevBreak = before.lastIndexOf("\n");
	return before.slice(prevBreak + 1);
}

function nextNonEmptyLine(source, lineEnd) {
	const after = source.slice(lineEnd).replace(/^\s+/, "");
	const nextBreak = after.indexOf("\n");
	return after.slice(0, nextBreak === -1 ? after.length : nextBreak);
}

function findBalancedEnd(source, openIndex) {
	const open = source[openIndex];
	const close = open === "(" ? ")" : open === "{" ? "}" : null;
	if (!close) {
		return -1;
	}
	let depth = 0;
	let quote = null;
	for (let i = openIndex; i < source.length; i += 1) {
		const ch = source[i];
		if (quote) {
			if (ch === "\\" && quote !== "`") {
				i += 1;
				continue;
			}
			if (ch === quote) {
				quote = null;
			}
			continue;
		}
		if (ch === "'" || ch === '"' || ch === "`") {
			quote = ch;
			continue;
		}
		if (ch === "/" && source[i + 1] === "/") {
			i = source.indexOf("\n", i);
			if (i < 0) {
				return -1;
			}
			continue;
		}
		if (ch === "/" && source[i + 1] === "*") {
			i = source.indexOf("*/", i + 2);
			if (i < 0) {
				return -1;
			}
			i += 1;
			continue;
		}
		if (ch === open) {
			depth += 1;
		} else if (ch === close) {
			depth -= 1;
			if (depth === 0) {
				return i + 1;
			}
		}
	}
	return -1;
}

function offsetToLine(source, offset) {
	let line = 1;
	for (let i = 0; i < offset; i += 1) {
		if (source[i] === "\n") {
			line += 1;
		}
	}
	return line;
}

async function readAllowlist(filePath) {
	const text = await fs.readFile(filePath, "utf8");
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
}

async function walkFiles(rootDir, extensions) {
	const out = [];
	if (!(await pathExists(rootDir))) {
		return out;
	}
	async function visit(dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!IGNORE_DIR_NAMES.has(entry.name)) {
					await visit(full);
				}
				continue;
			}
			if (entry.isFile() && extensions.has(path.extname(entry.name))) {
				out.push(full);
			}
		}
	}
	await visit(rootDir);
	return out;
}

async function pathExists(targetPath) {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function isDirectory(targetPath) {
	try {
		const stat = await fs.stat(targetPath);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

function toPosix(filePath) {
	return path
		.relative(repoRoot, filePath)
		.split(path.sep)
		.join(path.posix.sep);
}

function printResult(result) {
	const label = result.status.toUpperCase();
	console.log(`\n${result.id} ${result.title} — ${label}`);
	for (const line of result.details) {
		console.log(`  ${line}`);
	}
}
