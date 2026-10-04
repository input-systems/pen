/**
 * Load-bearing lock for exported helpers. A helper that can quietly do
 * nothing is how two-peer collaboration and ASSERT_DOC_EQUALS_FIELDS
 * shipped green in the sibling test package. Each case would fail if
 * the named helper returned empty / identity / always-ok.
 *
 * No-op'd against this node suite and stayed green: `scenario`,
 * `getInlineOffsetPoint` / `resolveBlockId`, `runPropertySuite`, and
 * the rest of the Playwright/DOM surface (`standingAssertions`,
 * `axeSurface` analyzers, `harness/src/geometry.ts`, `session.ts`
 * besides `connectPeers` / `serialize*`). Those are load-bearing only
 * when Playwright runs.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { connectPeers } from "../connectPeers.ts";
import {
	formatCheckReport,
	formatDiagnosticsReport,
	formatDomAuthorityReport,
} from "../checkReport.js";
import { parseNumericFuzzSeed } from "../fuzz/run-properties.mjs";
import { discoverPublishedExportPaths } from "./discover.js";
import {
	classifyDrift,
	formatDriftReport,
	formatMetricLine,
	nearestRankPercentile,
	sampleStats,
	signedDelta,
	summarizeTypingBudget,
	compareTypingBudgets,
} from "../typingBudget.js";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

test("connectPeers: peer B receives peer A's insert", () => {
	const local = new Y.Doc({ gc: false });
	const remote = new Y.Doc({ gc: false });
	Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
	const disconnect = connectPeers(local, remote);
	local.getArray("blockOrder").push(["from-a"]);
	assert.deepEqual(remote.getArray("blockOrder").toArray(), ["from-a"]);
	disconnect();
});

test("connectPeers no-op would drop the insert", () => {
	const local = new Y.Doc({ gc: false });
	const remote = new Y.Doc({ gc: false });
	Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
	const noop = () => {};
	noop();
	local.getArray("blockOrder").push(["from-a"]);
	assert.deepEqual(remote.getArray("blockOrder").toArray(), []);
});

test("serializeSelection computes isCollapsed; a lying input field is ignored", async () => {
	const { serializeSelection, serializeDiagnostic, serializeSelectionRecord } =
		await import("../../harness/src/serialize.ts");
	assert.equal(serializeSelection(null), null);
	const expanded = serializeSelection({
		type: "text",
		anchor: { blockId: "p1", offset: 2 },
		focus: { blockId: "p1", offset: 4 },
		isCollapsed: true,
	});
	assert.deepEqual(expanded, {
		type: "text",
		anchor: { blockId: "p1", offset: 2 },
		focus: { blockId: "p1", offset: 4 },
		isCollapsed: false,
	});
	const collapsed = serializeSelection({
		type: "text",
		anchor: { blockId: "p1", offset: 3 },
		focus: { blockId: "p1", offset: 3 },
	});
	assert.equal(collapsed?.type === "text" && collapsed.isCollapsed, true);
	const diagnostic = serializeDiagnostic({
		code: "dom-divergence",
		level: "error",
		source: "test",
		message: "x",
		reason: "why",
	});
	assert.equal(diagnostic.code, "dom-divergence");
	assert.equal(diagnostic.reason, "why");
	assert.equal(serializeSelectionRecord(null), null);
	const record = serializeSelectionRecord({
		version: 4,
		origin: "mapped",
		commitId: 7,
		state: {
			type: "text",
			anchor: { blockId: "p1", offset: 2 },
			focus: { blockId: "p1", offset: 2 },
			affinity: "downstream",
			goalX: null,
		},
	});
	assert.equal(record?.version, 4);
	assert.equal(record?.origin, "mapped");
	assert.equal(record?.commitId, 7);
	assert.equal(record?.state?.type, "text");
});

test("scenarios call the bridge helper, not selection.isCollapsed", () => {
	const files = [
		"../../scenarios/f39-undo-selection.spec.ts",
		"../../scenarios/f39-caret-overlay.spec.ts",
		"../../suites/specHelpers.ts",
	];
	for (const rel of files) {
		const body = readFileSync(new URL(rel, import.meta.url), "utf8");
		assert.match(
			body,
			/__penConformance\.isCollapsed\(\)/,
			`${rel} must call the official helper on the bridge`,
		);
		assert.doesNotMatch(
			body,
			/selection\.isCollapsed/,
			`${rel} still reads the live/DTO property the selection redesign is removing`,
		);
		assert.doesNotMatch(
			body,
			/const selection = await page\.evaluate[\s\S]{0,240}window\.__penConformance\.isCollapsed\(\)/,
			`${rel} calls isCollapsed() in Node after a page.evaluate — window is not defined there`,
		);
	}
	const serialize = readFileSync(
		new URL("../../harness/src/serialize.ts", import.meta.url),
		"utf8",
	);
	assert.match(serialize, /isCollapsed\(selection\)/);
	assert.doesNotMatch(serialize, /isCollapsed:\s*selection\.isCollapsed/);
	const session = readFileSync(
		new URL("../../harness/src/session.ts", import.meta.url),
		"utf8",
	);
	assert.match(session, /selectionIsCollapsed\(/);
	assert.match(session, /isCollapsed\(\)\s*\{/);
});

test("sampleCaretPoints samples empty and mid offsets", async () => {
	const { sampleCaretPoints } = await import("../g5Geometry.ts");
	const empty = sampleCaretPoints([{ id: "g5-empty", length: 0 }]);
	assert.ok(empty.length > 0, "empty block produced no caret points");
	assert.ok(empty.every((point) => point.offset === 0));
	assert.ok(empty.some((point) => point.affinity === "downstream"));
	assert.ok(empty.some((point) => point.affinity === "upstream"));

	const mid = sampleCaretPoints([{ id: "wrap", length: 4 }]);
	const offsets = new Set(mid.map((point) => point.offset));
	assert.ok(offsets.has(0));
	assert.ok(offsets.has(2));
	assert.ok(offsets.has(4));
	assert.equal(sampleCaretPoints([]).length, 0);
});

test("tenK generator is 10000 paragraph words plus a cell-text cohort", async () => {
	const { readFileSync } = await import("node:fs");
	const { fileURLToPath } = await import("node:url");
	const {
		generateTenKParagraphs,
		generateTenKCells,
		tenKFixtureIdentity,
		tenKParagraphsSha256,
		tenKWordOps,
		tenKBlockId,
		TEN_K_WORD_COUNT,
		TEN_K_PARAGRAPH_COUNT,
		TEN_K_CELL_COUNT,
		TEN_K_CELL_WORD_COUNT,
		TEN_K_TABLE_ID,
	} = await import("../tenKWordFixture.ts");
	const paragraphs = generateTenKParagraphs();
	const cells = generateTenKCells();
	assert.equal(paragraphs.length, TEN_K_PARAGRAPH_COUNT);
	assert.equal(cells.length, TEN_K_CELL_COUNT);
	assert.ok(
		cells.every((cell) => cell.text.split(" ").length === 50),
		"each cell must carry a 50-word cohort, not an empty string",
	);
	const identity = tenKFixtureIdentity(paragraphs, cells);
	assert.equal(identity.paragraphCount, TEN_K_PARAGRAPH_COUNT);
	assert.equal(identity.wordCount - identity.cellWordCount, TEN_K_WORD_COUNT);
	assert.equal(identity.cellWordCount, TEN_K_CELL_WORD_COUNT);
	assert.equal(identity.cellCount, TEN_K_CELL_COUNT);
	const baseline = JSON.parse(
		readFileSync(
			fileURLToPath(
				new URL("../../baselines/typing-budget.chromium.json", import.meta.url),
			),
			"utf8",
		),
	);
	assert.equal(
		typeof baseline.fixture.paragraphSha256,
		"string",
		"re-recorded baseline must keep paragraphSha256 so a cell-only edit is visible",
	);
	assert.equal(
		tenKParagraphsSha256(paragraphs),
		baseline.fixture.paragraphSha256,
		"paragraph LCG walk must stay bit-identical to the committed baseline",
	);
	assert.equal(
		identity.contentSha256,
		baseline.fixture.contentSha256,
		"contentSha256 must match the re-recorded cell-inclusive fixture",
	);
	assert.notEqual(
		identity.contentSha256,
		baseline.fixture.paragraphSha256,
		"contentSha256 must include the cell cohort so a run cannot ignore it",
	);
	assert.equal(baseline.fixture.cellWordCount, TEN_K_CELL_WORD_COUNT);
	assert.equal(baseline.fixture.cellCount, TEN_K_CELL_COUNT);
	const independent = createHash("sha256")
		.update(
			[
				...paragraphs,
				...cells.map((cell) => `${cell.row},${cell.col}:${cell.text}`),
			].join("\n"),
			"utf8",
		)
		.digest("hex");
	assert.equal(identity.contentSha256, independent);
	console.log(
		`tenK contentSha256 (paragraphs+cells) → ${identity.contentSha256}`,
	);
	console.log(
		`tenK paragraphSha256 (unchanged) → ${identity.paragraphSha256}`,
	);

	const ops = tenKWordOps("hello-p1", 11);
	assert.ok(
		ops.some(
			(op) =>
				op.type === "splice-text" &&
				op.insert === "" &&
				op.from === 0 &&
				op.to === 11,
		),
	);
	assert.ok(ops.some((op) => op.type === "insert-block" && op.blockType === "paragraph"));
	assert.ok(
		ops.some(
			(op) =>
				op.type === "insert-block" &&
				op.blockType === "table" &&
				op.blockId === TEN_K_TABLE_ID,
		),
		"tenKWordOps must insert the cell-text table",
	);
	const cellOps = ops.filter(
		(op) => op.type === "splice-text" && op.cell != null,
	);
	console.log(
		`tenKWordOps splice-text cell → ${cellOps.length} ops`,
	);
	assert.equal(cellOps.length, TEN_K_CELL_COUNT);
	assert.equal(tenKBlockId(3), "w3-10k-p03");
});

test("parseNumericFuzzSeed does not collapse a run-id string to 0", () => {
	assert.equal(parseNumericFuzzSeed(""), 20260819);
	assert.equal(parseNumericFuzzSeed(null), 20260819);
	assert.equal(parseNumericFuzzSeed("42"), 42);
	const hashed = parseNumericFuzzSeed("123-1-1700000000");
	assert.notEqual(hashed, 0);
	assert.notEqual(hashed, 20260819);
	assert.equal(hashed, parseNumericFuzzSeed("123-1-1700000000"));
});

test("isFixtureName and windowedBlockId are live predicates, not always-true", async () => {
	const { readFileSync } = await import("node:fs");
	const { fileURLToPath } = await import("node:url");
	const catalog = readFileSync(
		fileURLToPath(new URL("../../fixtures/catalog.ts", import.meta.url)),
		"utf8",
	);
	assert.match(catalog, /return `win-\$\{index\}`/);
	assert.match(
		catalog,
		/hasOwnProperty\.call\(LOCAL_FIXTURES, name\)/,
	);
	assert.match(
		catalog,
		/hasOwnProperty\.call\(SCALE_FIXTURE_ROOT_COUNTS, name\)/,
	);
	assert.match(
		catalog,
		/isLocalFixtureName\(name\) \|\|\s*isScaleFixtureName\(name\) \|\|\s*name === "deterministic"/,
	);
	assert.match(catalog, /hasOwnProperty\.call\(FUZZ_FIXTURES, name\)/);
	assert.match(catalog, /name === "deterministic" \|\|\s*isFuzzFixtureName\(name\)/);
	assert.doesNotMatch(
		catalog,
		/export function isFixtureName[\s\S]*return true;/,
	);
});

test("discoverPublishedExportPaths finds core and skips private packages", () => {
	const entries = discoverPublishedExportPaths(repoRoot);
	assert.ok(entries.length > 0);
	const names = new Set(entries.map((entry) => entry.packageName));
	assert.ok(names.has("@input/pen-core"));
	assert.equal(names.has("@input/pen-conformance"), false);
});

test("typingBudget helpers move when inputs move", () => {
	assert.equal(nearestRankPercentile([], 95), null);
	assert.equal(nearestRankPercentile([1, 2, 3, 4], 50), 2);
	const stats = sampleStats([2, 4, 6]);
	assert.equal(stats.count, 3);
	assert.equal(stats.min, 2);
	assert.equal(stats.max, 6);
	assert.equal(stats.mean, 4);
	assert.deepEqual(signedDelta(10, 12), { abs: 2, pct: 20 });
	assert.deepEqual(signedDelta(null, 1), { abs: null, pct: null });
	assert.equal(
		classifyDrift({ kind: "count", baseline: 1, current: 2 }),
		"loud",
	);
	assert.equal(
		classifyDrift({ kind: "time", baseline: 1, current: 1.05 }),
		"quiet",
	);
	const line = formatMetricLine("flushCount", "count", 1, 2);
	assert.equal(line.level, "loud");
	assert.match(line.line, /1 → 2/);
	const summary = summarizeTypingBudget({
		readPhaseMs: [1, 2, 3],
		writePhaseMs: [0],
		measureNowPerKeystroke: [0, 0],
		flushesPerFrame: [1, 1],
		flushCount: 2,
		keystrokeCount: 2,
	});
	assert.equal(summary.keystrokeCount, 2);
	assert.equal(summary.flushCount, 2);
	assert.notEqual(summary.readPhaseP95Ms, null);
	const compared = compareTypingBudgets(
		{ summary },
		{
			summary: { ...summary, flushCount: 3 },
		},
	);
	assert.ok(compared.loud.length > 0);
	const report = formatDriftReport(
		{ summary, fixture: { contentSha256: "a" } },
		{ summary: { ...summary, flushCount: 3 }, fixture: { contentSha256: "a" } },
	);
	assert.equal(report.loud, true);
	assert.match(report.text, /record-only/);
});

test("checkReport titles stay honest under a no-op-shaped input", () => {
	assert.equal(formatCheckReport("x", "passed"), "passed: x");
	assert.doesNotMatch(formatCheckReport("x", "passed"), /failed/);
	assert.match(formatDomAuthorityReport({ ok: false, reason: "r" }), /^failed:/);
	assert.match(formatDiagnosticsReport([]), /^passed:/);
	assert.match(formatDiagnosticsReport([{ code: "dom-divergence" }]), /^failed:/);
});

test("STANDING_DIAGNOSTIC_CODES is a non-empty closed list", async () => {
	const { STANDING_DIAGNOSTIC_CODES, DIAGNOSTICS_ALLOWLIST } = await import(
		"../diagnosticsAllowlist.ts"
	);
	assert.ok(STANDING_DIAGNOSTIC_CODES.includes("dom-divergence"));
	assert.ok(STANDING_DIAGNOSTIC_CODES.includes("selection-projection-mismatch"));
	assert.ok(STANDING_DIAGNOSTIC_CODES.length > 0);
	// The target is an empty list. An entry is a ratchet: it must name the
	// workstream requirement or step that removes it.
	for (const entry of DIAGNOSTICS_ALLOWLIST) {
		assert.ok(STANDING_DIAGNOSTIC_CODES.includes(entry.code), entry.code);
		assert.match(entry.reason, /W\d+(\.R\d+| step \d+)/, entry.code);
	}
});
