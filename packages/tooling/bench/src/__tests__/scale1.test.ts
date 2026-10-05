import { withGatedRung } from "./envelopeRecordFixtures";
import { assertPeerEditsSurvive, createTestEditor } from "@input/pen-test";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { bench, type BenchResult } from "../bench";
import {
	ENVELOPE_DRIFT_FLOOR_MS,
	ENVELOPE_DRIFT_RATIO,
	ENVELOPE_GATE_MIN_SIGNAL_MS,
	ENVELOPE_SAMPLE_SIZE,
	SCALE1_BLOCK_COUNTS,
	SCALE1_LONG_BLOCK_CHARS,
	SCALE1_MACHINE_CLASS,
	SCALE1_MEASUREMENTS,
	SCALE1_NESTING_DEPTH,
	SCALE1_PEER_COUNT,
	SCALE1_TABLE_COLS,
	SCALE1_TABLE_ROWS,
	envelopeGateP50Ms,
	envelopePointIsGated,
} from "../constants/scale1";
import {
	buildEnvelopeRecord,
	compareEnvelopeDrift,
	formatEnvelopeDrift,
	loadCommittedEnvelope,
	type EnvelopeRecord,
} from "../envelope/compare";
import { envelopeGateClass } from "../envelope/machine";
import {
	assertScale1AuditCoversMeasurements,
	SCALE1_FIXTURE_AUDIT,
} from "../fixtures/audit";
import {
	ENVELOPE_LONG_BLOCK_ID,
	ENVELOPE_TABLE_BLOCK_ID,
	assertPeerBObservedText,
	assertPeerBObservesPeerAInsert,
	createEnvelopeCollaboration,
	createEnvelopeEditor,
	createNestingEditor,
	createTableEditor,
	envelopeBlockId,
	envelopeNestId,
	generateBlockSpecs,
	generateLongBlockSpec,
	measureCreatedNestingDepth,
	measureCreatedTableCells,
	measureIndependentPeerSurvival,
	measurePeerTokenSurvival,
	measureNestingDepth,
	measurePublishedCount,
	measureSharedSeedPeerCount,
} from "../fixtures/envelope";
import { parseBenchCLIArgs } from "../run";
import {
	createPeerRunner,
	scale1Benchmarks,
	scale1FloorBenchmarks,
} from "../suites/scale1.bench";

describe("SCALE1 envelope ladder", () => {
	it("SCALE1: uses the published metadata axis ids and rung sizes", () => {
		expect(SCALE1_MEASUREMENTS.map((entry) => entry.axis)).toEqual([
			"blockCount",
			"blockCount",
			"blockCount",
			"longestBlock",
			"nestingDepth",
			"table",
			"concurrentPeers",
		]);
		expect(SCALE1_BLOCK_COUNTS).toEqual([100, 1000, 5000]);
		expect(SCALE1_LONG_BLOCK_CHARS).toBe(100_000);
		expect(SCALE1_NESTING_DEPTH).toBe(10);
		expect(SCALE1_TABLE_ROWS).toBe(50);
		expect(SCALE1_TABLE_COLS).toBe(20);
		expect(SCALE1_PEER_COUNT).toBe(2);
		expect(
			SCALE1_MEASUREMENTS.map((entry) => entry.metadataRungId),
		).toEqual([
			"blocks-100",
			"blocks-1000",
			"blocks-5000",
			"long-block",
			"nesting-10",
			"table-50x20",
			null,
		]);
	});

	it("SCALE1: names every bench after its metadata rung or axis point", () => {
		expect(scale1Benchmarks.map((bench) => bench.id)).toEqual(
			SCALE1_MEASUREMENTS.map((spec) => `scale1.envelope.${spec.id}`),
		);
		expect(
			scale1Benchmarks.every((bench) => bench.name.includes("SCALE1")),
		).toBe(true);
	});

	it("SCALE1: 100-block rung matches the published generator ids", () => {
		expect(generateBlockSpecs(100)).toHaveLength(100);
		expect(generateBlockSpecs(100)[0]).toEqual({
			id: "envelope-block-0",
			type: "heading",
			content: "Block 0",
			props: { level: 1 },
		});
		const editor = createEnvelopeEditor("blocks-100");
		expect(editor.document.blockOrder.length).toBe(100);
		expect(editor.getBlock(envelopeBlockId(99)).textContent()).toBe(
			"Block 99",
		);
		expect(blockTypesIn(editor)).toEqual(
			new Set(["heading", "codeBlock", "paragraph"]),
		);
		void editor.destroy();
	});

	it("SCALE1: 1000-block and 5000-block rungs load the claimed sizes", () => {
		expect(generateBlockSpecs(1000)).toHaveLength(1000);
		expect(generateBlockSpecs(5000)).toHaveLength(5000);
		for (const [rungId, count] of [
			["blocks-1000", 1000],
			["blocks-5000", 5000],
		] as const) {
			const editor = createEnvelopeEditor(rungId);
			expect(editor.document.blockOrder.length).toBe(count);
			expect(editor.getBlock(envelopeBlockId(count - 1)).textContent()).toBe(
				`Block ${count - 1}`,
			);
			expect(blockTypesIn(editor)).toEqual(
				new Set(["heading", "codeBlock", "paragraph"]),
			);
			void editor.destroy();
		}
	}, 60_000);

	it("SCALE1: 100k-character block loads", () => {
		const editor = createEnvelopeEditor("long-block");
		expect(
			editor.getBlock(ENVELOPE_LONG_BLOCK_ID).textContent().length,
		).toBe(SCALE1_LONG_BLOCK_CHARS);
		void editor.destroy();
	});

	it("SCALE1: nesting depth 10 is a chain, not ten siblings", () => {
		const editor = createEnvelopeEditor("nesting-10");
		expect(editor.document.blockOrder.length).toBe(1);
		expect(editor.document.blockOrder.get(0)).toBe(envelopeNestId(0));
		expect(measureNestingDepth(editor, envelopeNestId(0))).toBe(
			SCALE1_NESTING_DEPTH,
		);
		for (let level = 0; level < SCALE1_NESTING_DEPTH - 1; level++) {
			const parent = editor.getBlock(envelopeNestId(level));
			expect(parent.children.map((child) => child.id)).toEqual([
				envelopeNestId(level + 1),
			]);
		}
		expect(editor.getBlock(envelopeNestId(SCALE1_NESTING_DEPTH - 1)).children)
			.toHaveLength(0);
		void editor.destroy();
	});

	it("SCALE1: 50x20 table loads", () => {
		const editor = createEnvelopeEditor("table-50x20");
		expect(editor.document.blockOrder.length).toBe(1);
		expect(editor.document.blockOrder.get(0)).toBe(ENVELOPE_TABLE_BLOCK_ID);
		const table = editor.getBlock(ENVELOPE_TABLE_BLOCK_ID).as("table");
		expect(table?.tableRowCount()).toBe(SCALE1_TABLE_ROWS);
		expect(table?.tableColumnCount()).toBe(SCALE1_TABLE_COLS);
		void editor.destroy();
	});

	it("SCALE1: concurrentPeers uses the two-editor collaboration the table cites", () => {
		const collab = createEnvelopeCollaboration(100);
		expect(collab.editorA.document.blockOrder.length).toBe(100);
		expect(collab.editorB.document.blockOrder.length).toBe(100);
		assertPeerBObservesPeerAInsert(collab);

		const blockId = envelopeBlockId(50);
		collab.editorA.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
				to: 0,
				insert: "PEER-A",
				},
			],
			{ origin: "user" },
		);
		collab.editorB.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
				to: 0,
				insert: "PEER-B",
				},
			],
			{ origin: "user" },
		);
		const fromA = collab.editorA.crdtDoc.adapter.encodeUpdate(
			collab.editorA.crdtDoc,
			Y.encodeStateVector(collab.editorB.ydoc),
		);
		const fromB = collab.editorB.crdtDoc.adapter.encodeUpdate(
			collab.editorB.crdtDoc,
			Y.encodeStateVector(collab.editorA.ydoc),
		);
		expect(fromA.byteLength).toBeGreaterThan(0);
		expect(fromB.byteLength).toBeGreaterThan(0);
		collab.sync();
		assertPeerEditsSurvive([collab.editorA, collab.editorB], {
			blockId,
			tokens: ["PEER-A", "PEER-B"],
		});
		void collab.editorA.destroy();
		void collab.editorB.destroy();
	});

	it("SCALE1: observation fails when B already has A's token", () => {
		const collab = createEnvelopeCollaboration(4);
		collab.editorB.apply(
			[
				{
					type: "splice-text",
					blockId: envelopeBlockId(0),
					from: 0,
				to: 0,
				insert: "PEER-A-OBSERVED",
				},
			],
			{ origin: "user" },
		);
		expect(() => assertPeerBObservesPeerAInsert(collab)).toThrow(
			/already present on peer B/,
		);
		void collab.editorA.destroy();
		void collab.editorB.destroy();
	});

	it("SCALE1: observation fails when A and B are the same document", () => {
		const editor = createTestEditor({ blocks: generateBlockSpecs(4) });
		const collab = {
			editorA: editor,
			editorB: editor,
			sync() {},
		};
		expect(() => assertPeerBObservesPeerAInsert(collab)).toThrow(
			/before sync/,
		);
		void editor.destroy();
	});

	it("SCALE1: observation fails when sync is a no-op", () => {
		const collab = createEnvelopeCollaboration(4);
		collab.sync = () => {};
		expect(() => assertPeerBObservesPeerAInsert(collab)).toThrow(
			/did not observe peer A's insert/,
		);
		void collab.editorA.destroy();
		void collab.editorB.destroy();
	});

	it("SCALE1: a no-op sync refuses to publish the concurrent-peers bench", async () => {
		const runner = createPeerRunner(() => {
			const collab = createEnvelopeCollaboration(100);
			collab.sync = () => {};
			return collab;
		});
		await expect(
			bench(runner.fn.name || "peer-noop-sync", runner.fn, {
				iterations: 1,
				warmup: 0,
			}),
		).rejects.toThrow(/did not observe peer A's insert after sync/);
		await runner.teardown?.();
	});

	it("SCALE1: a sync broken after observe refuses to publish the timed insert", async () => {
		const runner = createPeerRunner(() => {
			const collab = createEnvelopeCollaboration(100);
			const realSync = collab.sync.bind(collab);
			let calls = 0;
			collab.sync = () => {
				calls += 1;
				if (calls === 1) {
					realSync();
				}
			};
			return collab;
		});
		await expect(
			bench("peer-broken-after-observe", runner.fn, {
				iterations: 1,
				warmup: 0,
			}),
		).rejects.toThrow(/did not observe peer A's insert after sync/);
		await runner.teardown?.();
	});

	it("SCALE1: assertPeerBObservedText fails when B never received the token", () => {
		const collab = createEnvelopeCollaboration(4);
		expect(() =>
			assertPeerBObservedText(collab, envelopeBlockId(0), "NEVER-SYNCED"),
		).toThrow(/did not observe peer A's insert after sync/);
		void collab.editorA.destroy();
		void collab.editorB.destroy();
	});

	it("SCALE1: every envelope bench declares a harness floor", () => {
		expect(scale1Benchmarks.every((entry) => typeof entry.floor === "function")).toBe(
			true,
		);
	});

	it("SCALE1: independently populated peers lose an edit after sync", () => {
		expect(measureIndependentPeerSurvival()).toBeLessThan(2);
	});

	it("SCALE1: the concurrent-peers bench refuses to time until B observes A's insert", async () => {
		const peerBench = scale1Benchmarks.find(
			(entry) => entry.id === "scale1.envelope.concurrentPeers-2",
		);
		if (!peerBench) {
			throw new Error("concurrentPeers-2 bench missing");
		}
		await bench(peerBench.name, peerBench.fn, {
			iterations: 1,
			warmup: 0,
		});
		await peerBench.teardown?.();
	});

	it("SCALE1: fixture audit covers every measurement and names the two historical misses", () => {
		expect(() => assertScale1AuditCoversMeasurements()).not.toThrow();
		expect(SCALE1_FIXTURE_AUDIT.map((row) => row.id)).toEqual(
			SCALE1_MEASUREMENTS.map((spec) => spec.id),
		);
		const peers = SCALE1_FIXTURE_AUDIT.find(
			(row) => row.id === "concurrentPeers-2",
		);
		expect(peers?.verdict).toBe("name-overstates");
		expect(peers?.actualSubject).toMatch(/Peer B does not write/);
		expect(peers?.floorKind).toBe("empty-sync");
		expect(peers?.countTrust).toBe("trusted");
		// The 2026-10-02 quiet record reproduced the isolated run, so the row
		// takes its clock trust from the record like the ladder rungs.
		expect(peers?.clockTrust).toBe("record");
		expect(peers?.howMeasured).toMatch(/B observation asserted before the clock/);
	});

	it("SCALE1: floor benches pair 1:1 with the wall-clock benches", () => {
		expect(scale1FloorBenchmarks.map((bench) => bench.id)).toEqual(
			SCALE1_MEASUREMENTS.map(
				(spec) => `scale1.envelope.${spec.id}.floor`,
			),
		);
	});

	it("SCALE1: machine-class token ignores the ubuntu disclaimer on the macos label", () => {
		expect(envelopeGateClass(SCALE1_MACHINE_CLASS)).toBe("macos-arm64");
		expect(
			envelopeGateClass("linux-x64 (github-actions-ubuntu-latest)"),
		).toBe("linux");
	});

	it("SCALE1: CH8 gates the median of a stated sample, derived from measured variance", () => {
		expect(ENVELOPE_SAMPLE_SIZE).toBe(21);
		expect(ENVELOPE_DRIFT_RATIO).toBe(3);
		expect(ENVELOPE_DRIFT_FLOOR_MS).toBe(1);
		expect(ENVELOPE_GATE_MIN_SIGNAL_MS).toBe(0.5);
		expect(envelopePointIsGated(0.21)).toBe(false);
		expect(envelopePointIsGated(0.5)).toBe(true);
		expect(envelopeGateP50Ms(0.5)).toBe(1.5);
		expect(envelopeGateP50Ms(6.13)).toBe(18.39);
		expect(SCALE1_MACHINE_CLASS).toMatch(/macos-arm64/);
		expect(SCALE1_MACHINE_CLASS).toMatch(/Not the CI runner/);
	});

	it("SCALE1: attributed time is wall minus floor", () => {
		const record = recordWithP50(6.13, 0.13);
		const blocks5000 = record.points.find(
			(point) => point.id === "blocks-5000",
		);
		expect(blocks5000?.measuredP50Ms).toBe(6.13);
		expect(blocks5000?.floorP50Ms).toBe(0.13);
		expect(blocks5000?.attributedP50Ms).toBe(6);
		expect(blocks5000?.count).toBe(5000);
		expect(blocks5000?.countUnit).toBe("blocks");
		expect(blocks5000?.opsApplied).toBe(1);
		expect(blocks5000?.gated).toBe(true);
		expect(blocks5000?.gateP50Ms).toBe(18);
	});

	it("SCALE1: a row without a floor cannot be built", () => {
		const results = SCALE1_MEASUREMENTS.map((spec) =>
			resultFor(`scale1.envelope.${spec.id}`, 4),
		);
		expect(() =>
			buildEnvelopeRecord(results, {
				floorResults: [],
				producedOn: "2026-08-20",
			}),
		).toThrow(/harness floor missing/);
	});

	it("SCALE1: a 3x attributed median on a gated rung stays at the gate", async () => {
		// A quiet record can leave every rung under the 0.5ms signal, so the
		// gated rung is built here rather than borrowed from the baseline.
		const committed = withGatedRung(
			await loadCommittedEnvelope(),
			"blocks-1000",
			2,
		);
		const gated = committed.points.find((point) => point.id === "blocks-1000");
		expect(gated?.gated).toBe(true);
		expect(gated?.gateP50Ms).toBe(envelopeGateP50Ms(gated!.attributedP50Ms));

		const at3x = withAttributed(committed, "blocks-1000", gated!.gateP50Ms!);
		const drift = compareEnvelopeDrift(at3x, committed);
		expect(drift.ok).toBe(true);
		expect(drift.failures).toEqual([]);
	});

	it("SCALE1: a 3x attributed median on an ungated rung does not trip the gate", async () => {
		const committed = await loadCommittedEnvelope();
		const ungated = committed.points.find((point) => point.id === "long-block");
		expect(ungated?.gated).toBe(false);

		const slowed = withAttributed(
			committed,
			"long-block",
			ungated!.attributedP50Ms * 10,
		);
		const drift = compareEnvelopeDrift(slowed, committed);
		expect(drift.ok).toBe(true);
		expect(drift.failures).toEqual([]);
	});

	it("SCALE1: a drifted count fails the envelope compare by name", async () => {
		const committed = await loadCommittedEnvelope();
		const fresh = withCount(committed, "blocks-1000", 10);
		const drift = compareEnvelopeDrift(fresh, committed);
		expect(drift.ok).toBe(false);
		expect(drift.failures.map((failure) => failure.id)).toEqual([
			"blocks-1000",
		]);
		expect(drift.failures[0]?.reason).toBe("count");
		expect(formatEnvelopeDrift(drift)).toMatch(
			/blocks-1000 count 10 !== committed 1000/,
		);
	});

	it("SCALE1: the concurrent-peer count is measured, not the constant", () => {
		expect(measureSharedSeedPeerCount()).toBe(2);
		expect(measureSharedSeedPeerCount(5)).toBe(5);
	});

	it("SCALE1: a dropped delivery moves concurrentPeers-2 below 2 and fails drift by name", async () => {
		// Peer a's update reaches b, but b's never reaches a.
		const measured = measureSharedSeedPeerCount(2, (harness) =>
			harness.deliver(0, 1),
		);
		expect(measured).toBeLessThan(2);

		const committed = await loadCommittedEnvelope();
		const fresh = withCount(committed, "concurrentPeers-2", measured);
		const drift = compareEnvelopeDrift(fresh, committed);
		expect(drift.ok).toBe(false);
		expect(drift.failures.map((failure) => failure.id)).toEqual([
			"concurrentPeers-2",
		]);
		expect(drift.failures[0]?.reason).toBe("count");
	});

	it("SCALE1: a median past the committed same-class gate fails drift", () => {
		const committed = recordWithP50(4);
		const gated = committed.points.find((point) => point.gated);
		expect(gated?.gateP50Ms).toBe(12);
		const fresh = recordWithP50((gated?.gateP50Ms ?? 0) + 0.01);
		const drift = compareEnvelopeDrift(fresh, committed);
		expect(drift.ok).toBe(false);
		expect(drift.skippedTiming).toBe(false);
		expect(formatEnvelopeDrift(drift)).toMatch(/blocks-100/);
	});

	it("SCALE1: a median at the committed same-class gate still passes", () => {
		const committed = recordWithP50(4);
		const gated = committed.points.find((point) => point.gated);
		const fresh = recordWithP50(gated?.gateP50Ms ?? 0);
		expect(compareEnvelopeDrift(fresh, committed).ok).toBe(true);
	});

	it("SCALE1: sub-signal rungs are recorded and not gated", () => {
		const committed = recordWithP50(0.21);
		expect(committed.points.every((point) => point.gated === false)).toBe(
			true,
		);
		const fresh = recordWithP50(8);
		const drift = compareEnvelopeDrift(fresh, committed);
		expect(drift.ok).toBe(true);
		expect(drift.skippedTiming).toBe(false);
	});

	it("SCALE1: cross-class timing is not compared", () => {
		const committed = recordWithP50(4);
		const fresh = recordWithP50(
			80,
			0,
			"linux-x64 (github-actions-ubuntu-latest)",
		);
		const drift = compareEnvelopeDrift(fresh, committed);
		expect(drift.ok).toBe(true);
		expect(drift.skippedTiming).toBe(true);
		expect(formatEnvelopeDrift(drift)).toMatch(/timing not compared/);
	});

	it("SCALE1: parseBenchCLIArgs accepts the envelope flags", () => {
		expect(parseBenchCLIArgs(["--envelope", "--json"])).toEqual({
			reporter: "json",
			envelope: true,
		});
		expect(parseBenchCLIArgs(["--write-envelope"])).toEqual({
			reporter: "console",
			envelope: true,
			writeEnvelope: true,
		});
	});
});

describe("SCALE1 ladder mutation", () => {
	it("SCALE1: mutating generateBlockSpecs moves the block-count rows", async () => {
		const committed = await loadCommittedEnvelope();
		expect(generateBlockSpecs(100)).toHaveLength(100);
		expect(generateBlockSpecs(20)).toHaveLength(20);
		expect(generateBlockSpecs(1000)).toHaveLength(1000);
		expect(generateBlockSpecs(10)).toHaveLength(10);
		expect(generateBlockSpecs(5000)).toHaveLength(5000);
		expect(generateBlockSpecs(15)).toHaveLength(15);

		expect(measurePublishedCount("blocks-100")).toBe(100);
		expect(measurePublishedCount("blocks-1000")).toBe(1000);
		expect(measurePublishedCount("blocks-5000")).toBe(5000);

		for (const [id, mutated] of [
			["blocks-100", 20],
			["blocks-1000", 10],
			["blocks-5000", 15],
		] as const) {
			const drift = compareEnvelopeDrift(
				withCount(committed, id, mutated),
				committed,
			);
			expect(drift.ok, id).toBe(false);
			expect(drift.failures.map((failure) => failure.id)).toEqual([id]);
			expect(formatEnvelopeDrift(drift)).toContain(id);
		}
	});

	it("SCALE1: mutating generateLongBlockSpec moves the long-block row", async () => {
		const committed = await loadCommittedEnvelope();
		const published = generateLongBlockSpec()[0]?.content?.length;
		expect(published).toBe(100_000);
		expect(generateLongBlockSpec(100)[0]?.content?.length).toBe(100);
		expect(measurePublishedCount("long-block")).toBe(100_000);

		const drift = compareEnvelopeDrift(
			withCount(committed, "long-block", 100),
			committed,
		);
		expect(drift.ok).toBe(false);
		expect(formatEnvelopeDrift(drift)).toMatch(
			/long-block count 100 !== committed 100000/,
		);
	});

	it("SCALE1: mutating nesting depth moves the nesting-10 row", async () => {
		const committed = await loadCommittedEnvelope();
		expect(measureCreatedNestingDepth(10)).toBe(10);
		expect(measureCreatedNestingDepth(3)).toBe(3);
		const mutated = createNestingEditor(3);
		expect(measureNestingDepth(mutated, envelopeNestId(0))).toBe(3);
		void mutated.destroy();

		const drift = compareEnvelopeDrift(
			withCount(committed, "nesting-10", 3),
			committed,
		);
		expect(drift.ok).toBe(false);
		expect(formatEnvelopeDrift(drift)).toMatch(
			/nesting-10 count 3 !== committed 10/,
		);
	});

	it("SCALE1: mutating table dimensions moves the table-50x20 row", async () => {
		const committed = await loadCommittedEnvelope();
		expect(measureCreatedTableCells(50, 20)).toBe(1000);
		expect(measureCreatedTableCells(5, 4)).toBe(20);
		const mutated = createTableEditor(5, 4);
		const table = mutated.getBlock(ENVELOPE_TABLE_BLOCK_ID).as("table");
		expect(table?.tableRowCount()).toBe(5);
		expect(table?.tableColumnCount()).toBe(4);
		void mutated.destroy();

		const drift = compareEnvelopeDrift(
			withCount(committed, "table-50x20", 20),
			committed,
		);
		expect(drift.ok).toBe(false);
		expect(formatEnvelopeDrift(drift)).toMatch(
			/table-50x20 count 20 !== committed 1000/,
		);
	});

	it("SCALE1: independently populated peers move survival below 2", async () => {
		const committed = await loadCommittedEnvelope();
		const shared = createEnvelopeCollaboration(4);
		expect(measurePeerTokenSurvival(shared)).toBe(2);
		void shared.editorA.destroy();
		void shared.editorB.destroy();

		const independent = measureIndependentPeerSurvival();
		expect(independent).toBeLessThan(2);

		const drift = compareEnvelopeDrift(
			withCount(committed, "concurrentPeers-2", independent),
			committed,
		);
		expect(drift.ok).toBe(false);
		expect(formatEnvelopeDrift(drift)).toContain("concurrentPeers-2");
	});
});

function blockTypesIn(
	editor: ReturnType<typeof createEnvelopeEditor>,
): Set<string> {
	const types = new Set<string>();
	for (let index = 0; index < editor.document.blockOrder.length; index++) {
		const id = editor.document.blockOrder.get(index);
		types.add(editor.getBlock(id).type);
	}
	return types;
}

function withCount(
	record: EnvelopeRecord,
	id: string,
	count: number,
): EnvelopeRecord {
	return {
		...record,
		points: record.points.map((point) => {
			if (point.id !== id) {
				return point;
			}
			return { ...point, count };
		}),
	};
}

function withAttributed(
	record: EnvelopeRecord,
	id: string,
	attributedP50Ms: number,
): EnvelopeRecord {
	return {
		...record,
		points: record.points.map((point) => {
			if (point.id !== id) {
				return point;
			}
			return {
				...point,
				measuredP50Ms: attributedP50Ms + point.floorP50Ms,
				attributedP50Ms,
			};
		}),
	};
}

function resultFor(id: string, p50Ms: number): BenchResult {
	return {
		id,
		name: id,
		iterations: ENVELOPE_SAMPLE_SIZE,
		totalMs: p50Ms * ENVELOPE_SAMPLE_SIZE,
		averageMs: p50Ms,
		minMs: p50Ms,
		maxMs: p50Ms,
		p50Ms,
		p95Ms: p50Ms,
		opsPerSecond: p50Ms === 0 ? 0 : 1000 / p50Ms,
		isCritical: false,
	};
}

function recordWithP50(
	p50Ms: number,
	floorP50Ms = 0,
	machineClass = SCALE1_MACHINE_CLASS,
) {
	const results = SCALE1_MEASUREMENTS.map((spec) =>
		resultFor(`scale1.envelope.${spec.id}`, p50Ms),
	);
	const floorResults = SCALE1_MEASUREMENTS.map((spec) =>
		resultFor(`scale1.envelope.${spec.id}.floor`, floorP50Ms),
	);
	return buildEnvelopeRecord(results, {
		floorResults,
		producedOn: "2026-08-20",
		floorProducedOn: "2026-08-21",
		machineClass,
		status: "provisional",
		caveat: "test fixture",
	});
}
