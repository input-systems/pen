import {
	RELATED_FIXTURE_AUDIT,
	SCALE1_FIXTURE_AUDIT,
	type FixtureAuditRow,
} from "../fixtures/audit";
import type {
	EnvelopePointRecord,
	EnvelopeRecord,
	EnvelopeRendererRow,
} from "./compare";
import { ENFORCEMENT_INVENTORY, type EnforcementRow } from "./enforcement";

/** Concurrent peers are verified at five (W5.R8): the n-peer COL4 rows run at 2, 3 and 5. */
const SCALE1_VERIFIED_PEER_COUNT = 5;

export function renderEnvelopeMarkdown(record: EnvelopeRecord): string {
	const statusLine =
		record.status === "provisional"
			? `**Status: provisional.** ${record.caveat}`
			: record.caveat;
	const axisRows = renderAxisRows(record);
	const ladderRows = record.points
		.map((point) => renderLadderRow(point, record))
		.join("\n");
	const auditRows = [...SCALE1_FIXTURE_AUDIT, ...RELATED_FIXTURE_AUDIT]
		.map((row) => renderAuditRow(row, record))
		.join("\n");
	const enforcementRows = ENFORCEMENT_INVENTORY.map((row) =>
		renderEnforcementRow(row),
	).join("\n");
	const rendererRows = record.renderer
		.map((row) => renderRendererRow(row))
		.join("\n");

	return `# Scale envelope

Generated from \`packages/tooling/bench/baselines/envelope.json\`. Do not edit by hand. Regenerate with \`pnpm --filter @input/pen-bench exec tsx src/envelope/writeTable.ts\`.

Rule: SCALE1 (\`${record.spec}\`). Grades: **verified** — a suite asserts behavior at this size on every run. **measured** — a benchmark records it, with harness floor subtracted, no pass/fail on the clock. **untested above** — the honest ceiling.

${statusLine}

Wall-clock sample: ${record.producedOn} on ${record.machineClass.replace(/\.$/, "")}. Median of ${record.sampleSize}. Floors: ${record.floorProducedOn}. A row without a floor is not a measurement.

## Fixture audit

Claimed subject versus what the fixture actually does. The last two published defects lived here: a concurrent-peers row whose peer B never received peer A's insert, and a streaming "regression" whose clock was 100 \`setTimeout(0)\` yields.

| Fixture | Claimed | Actual | Verdict | Trust | How measured |
| ------- | ------- | ------ | ------- | ----- | ------------ |
${auditRows}

## Envelope

| Axis | Verified | Measured | Untested above |
| ---- | -------- | -------- | -------------- |
${axisRows}

Verification for the ladder is headless (\`createTestEditor\`). Renderer rows come from \`@input/pen-conformance\` \`scale-render\` in Chromium: block counts at 1,000 and 5,000 are verified on every conformance run, and the clocks below are measured with a Pen-removed floor on the named machine class. Concurrent peers is verified at five for *survival of every peer's insert on every peer* (\`createPeerHarness\` + \`assertPeerEditsSurvive\`) and measured at two; the measured row's count is the number of peers that observed every insert, not a constant, and its clock is A insert + sync, not concurrent A+B.

## Renderer

Generated from the conformance \`scale-render\` baselines by \`pnpm --filter @input/pen-bench run bench:envelope:renderer\`. Mount runs from the fixture load to the second frame after every block is mounted; keystroke and caret-down run from the \`keydown\` to the second frame after it. The floor is the same fixture with Pen removed (\`?surface=static\`). Median of 5 mounts and 20 keys; clocks are recorded, never gated (CH8).

| Row | Surface | Root blocks | Total blocks | Grade | Mount p50 (ms) | Floor p50 (ms) | Keystroke→frame p50 (ms) | Caret down→frame p50 (ms) | Machine | Date |
| --- | ------- | ----------- | ------------ | ----- | -------------- | -------------- | ------------------------ | ------------------------- | ------- | ---- |
${rendererRows}

## Fixture ladder (counts)

Counts are the durable measure and do not decay under load. ${record.loadTaken ? `Wall-clocks below are **load-taken ${record.producedOn}** and must be re-measured on a quiet machine.` : `Wall-clocks below are a quiet-machine sample of ${record.producedOn}.`} A row without a fixture count is not a measurement.

| Rung | Fixture | Count | Ops | Floor | Date | Load | Wall p50 (ms) | Trust |
| ---- | ------- | ----- | --- | ----- | ---- | ---- | ------------- | ----- |
${ladderRows}

${renderGateNote(record)}

## Enforced vs record-only

A check that cannot fail is record-only even when a clock column exists. The unit suite never compares a live wall-clock to a budget. Isolated \`bench:envelope\` / \`bench:ci\` clocks are named below; decorative means a \`critical: true\` flag whose slack or subject cannot catch a regression.

| Row | Subject | Unit | Unit fails on | Isolated clock | Clock note |
| --- | ------- | ---- | ------------- | -------------- | ---------- |
${enforcementRows}

## Past the ceiling

Past these sizes, full-document mount and the renderer side of a structural commit (the block notifier's root list and sibling-list patch), which stay linear in block count, degrade first — Pen does not virtualize (\`spec/rules/dom.md\`). The core side of a structural commit advances its indexes by what the commit touched (SCALE2); \`CACHE-AUDIT.md\` records its cost at 1,000, 10,000 and 50,000 root blocks. Hosts that need larger documents window blocks themselves (\`packages/rendering/react/VIRTUALIZATION.md\`, SCALE5).
`;
}

function renderAxisRows(record: EnvelopeRecord): string {
	const block = record.points.filter((point) => point.axis === "blockCount");
	const longest = findPoint(record, "long-block");
	const nesting = findPoint(record, "nesting-10");
	const table = findPoint(record, "table-50x20");
	const peers = findPoint(record, "concurrentPeers-2");
	const largestBlock = block[block.length - 1];
	if (!largestBlock) {
		throw new Error("SCALE1 envelope missing block-count rungs");
	}

	const rows = [
		[
			"Block count",
			"5,000 (`@input/pen-test` SCALE1 `envelopeLadder`)",
			`${block.map((point) => point.size).join(" / ")} (\`@input/pen-bench\` SCALE1 ${block.map((point) => `\`${point.id}\``).join(", ")})`,
			largestBlock.size,
		],
		[
			"Longest single block",
			"100,000 characters (`@input/pen-test` SCALE1 `envelopeLadder`)",
			`${longest.size} (\`@input/pen-bench\` SCALE1 \`long-block\`)`,
			longest.size,
		],
		[
			"Nesting depth",
			"10 (`@input/pen-test` SCALE1 `envelopeLadder`)",
			`${nesting.size} (\`@input/pen-bench\` SCALE1 \`nesting-10\`)`,
			nesting.size,
		],
		[
			"Table",
			"50 × 20 (`@input/pen-test` SCALE1 `envelopeLadder`)",
			`${table.size} (\`@input/pen-bench\` SCALE1 \`table-50x20\`)`,
			table.size,
		],
		[
			"Concurrent peers",
			`${SCALE1_VERIFIED_PEER_COUNT} (\`@input/pen-test\` \`createPeerHarness\` + \`assertPeerEditsSurvive\`)`,
			`${peers.size} (\`@input/pen-bench\` SCALE1 \`concurrentPeers-2\`, A insert + sync)`,
			SCALE1_VERIFIED_PEER_COUNT,
		],
	];

	return rows.map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

function renderLadderRow(
	point: EnvelopePointRecord,
	record: EnvelopeRecord,
): string {
	const audit = SCALE1_FIXTURE_AUDIT.find((row) => row.id === point.id);
	if (!audit) {
		throw new Error(`SCALE1 fixture audit missing ${point.id}`);
	}
	const load = record.loadTaken
		? `load-taken ${record.producedOn}`
		: `quiet ${record.producedOn}`;
	return `| \`${point.id}\` | ${audit.fixture} | ${point.count} ${point.countUnit} | ${point.opsApplied} | ${point.floorKind} ${fmt(point.floorP50Ms)}ms | ${record.producedOn} | ${load} | ${fmt(point.measuredP50Ms)} | ${renderTrust(audit, record)} |`;
}

function renderTrust(row: FixtureAuditRow, record: EnvelopeRecord): string {
	const count =
		row.countTrust === "trusted" ? "count-trusted" : "count-untrusted";
	switch (row.clockTrust) {
		case "not-a-clock":
			return count;
		case "not-gated":
			return `${count}; clock recorded, not gated`;
		case "untrustworthy":
			return `${count}; clock untrustworthy`;
		case "record":
			return record.loadTaken ? `${count}; clock load-taken` : `${count}; clock quiet`;
		case "load-taken":
			return `${count}; clock load-taken`;
		default: {
			const unhandled: never = row.clockTrust;
			return unhandled;
		}
	}
}

function renderAuditRow(row: FixtureAuditRow, record: EnvelopeRecord): string {
	return `| ${row.fixture} | ${row.claimedSubject} | ${row.actualSubject} | ${row.verdict} | ${renderTrust(row, record)} | ${row.howMeasured} |`;
}

function renderRendererRow(row: EnvelopeRendererRow): string {
	const clock = (value: number | null) =>
		value === null ? (row.mountTimedOut ? "timed out" : "—") : fmt(value);
	return `| \`${row.id}\` | ${row.surface} | ${row.rootBlocks.toLocaleString("en-US")} | ${row.totalBlocks.toLocaleString("en-US")} | ${row.grade} | ${clock(row.mountP50Ms)} | ${clock(row.mountFloorP50Ms)} | ${clock(row.keystrokeToFrameP50Ms)} | ${clock(row.caretDownToFrameP50Ms)} | ${row.machineClass.split(" ")[0]} | ${row.recordedAt} |`;
}

function renderEnforcementRow(row: EnforcementRow): string {
	return `| \`${row.id}\` | ${row.subject} | ${row.unit} | ${row.unitFailsOn} | ${row.isolatedClock} | ${row.clockNote} |`;
}

function renderGateNote(record: EnvelopeRecord): string {
	const gated = record.points.filter((point) => point.gated);
	const ungated = record.points.filter((point) => !point.gated);
	const gatedList = gated
		.map(
			(point) =>
				`\`${point.id}\` gate ${fmt(point.gateP50Ms ?? Number.NaN)}ms`,
		)
		.join("; ");
	const ungatedList = ungated.map((point) => `\`${point.id}\``).join(", ");
	return `Count drift always fails, on every machine class. Same-class timing gate: ${record.tolerance.formula}. ${record.tolerance.justification} Gated clocks: ${gatedList || "none"}. Recorded clocks, not gated: ${ungatedList || "none"}. ${record.tolerance.crossClass}`;
}

function findPoint(record: EnvelopeRecord, id: string): EnvelopePointRecord {
	const point = record.points.find((entry) => entry.id === id);
	if (!point) {
		throw new Error(`SCALE1 envelope missing ${id}`);
	}
	return point;
}

function fmt(value: number): string {
	return value.toFixed(2);
}
