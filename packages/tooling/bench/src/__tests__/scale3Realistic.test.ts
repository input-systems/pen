import { createScanProbe } from "@input/pen-test";
import { describe, expect, it } from "vitest";
import {
	SCALE3_REALISTIC_BLOCK_COUNTS,
	SCALE3_REALISTIC_STAGED,
	createScale3RealisticEditor,
	observeScale3Realistic,
	scale3RealisticKeystroke,
	type Scale3RealisticBlockCount,
} from "../fixtures/scale3Realistic";
import {
	compareScale3RealisticPoints,
	loadScale3RealisticBaseline,
	scale3RealisticPointId,
	writeScale3RealisticCounts,
	type Scale3RealisticPoint,
} from "../fixtures/scale3RealisticBaseline";

/**
 * SCALE3 realistic stack (W1-S7): document reads one keystroke performs with
 * the real AI and search extensions holding live state. Counts, not clocks
 * (CH8). Record with RECORD_SCALE3_REALISTIC=1 SCALE3_REALISTIC_REASON="…".
 */
const RECORD = process.env.RECORD_SCALE3_REALISTIC === "1";
const WARMUP = 3;

async function measure(blockCount: Scale3RealisticBlockCount): Promise<Scale3RealisticPoint> {
	const editor = await createScale3RealisticEditor({ blockCount });
	const observed = observeScale3Realistic(editor);
	// A stand-in that silently replaced a real extension fails here.
	expect(observed).toEqual({ suggestionBlocks: SCALE3_REALISTIC_STAGED, searchMatches: 1 });
	for (let rep = 0; rep < WARMUP; rep += 1) scale3RealisticKeystroke(editor, blockCount);
	const probe = createScanProbe(editor);
	try {
		probe.selfTest();
		probe.reset();
		scale3RealisticKeystroke(editor, blockCount);
		return {
			id: scale3RealisticPointId(blockCount),
			blockCount,
			stagedSuggestions: observed.suggestionBlocks,
			searchMatches: observed.searchMatches,
			counts: probe.snapshot(),
		};
	} finally {
		probe.dispose();
		editor.destroy();
	}
}

describe("SCALE3 realistic stack", () => {
	it("SCALE3: realistic-stack keystroke document reads match the committed counts", async () => {
		const points: Scale3RealisticPoint[] = [];
		for (const blockCount of SCALE3_REALISTIC_BLOCK_COUNTS) points.push(await measure(blockCount));
		if (RECORD) {
			const reason = process.env.SCALE3_REALISTIC_REASON;
			if (!reason) throw new Error("RECORD_SCALE3_REALISTIC needs SCALE3_REALISTIC_REASON");
			writeScale3RealisticCounts(points, reason);
			return;
		}
		expect(compareScale3RealisticPoints(loadScale3RealisticBaseline(), points)).toEqual([]);
	}, 120_000);

	it("SCALE3: realistic-stack count drift fails by point id and counter name", () => {
		const point: Scale3RealisticPoint = {
			id: "scale3.realistic.keystroke.100",
			blockCount: 100,
			stagedSuggestions: 8,
			searchMatches: 1,
			counts: {
				blockOrderReads: 1,
				blocksMapReads: 2,
				blocksMapIterations: 3,
				textFullReads: 4,
				orderArrayReads: 0,
				documentWalks: 1,
			},
		};
		const baseline = {
			schemaVersion: 1 as const,
			rule: "SCALE3" as const,
			producedOn: "2026-10-02",
			points: [point],
			history: [],
		};
		const drifted = { ...point, counts: { ...point.counts, textFullReads: 5 } };
		expect(compareScale3RealisticPoints(baseline, [drifted])).toEqual([
			"scale3.realistic.keystroke.100/textFullReads: 5 !== 4",
		]);
		expect(compareScale3RealisticPoints(null, [point])[0]).toMatch(
			/^SCALE3_REALISTIC_BASELINE_MISSING/,
		);
		expect(compareScale3RealisticPoints({ ...baseline, points: [] }, [point])).toEqual([
			"SCALE3_REALISTIC_BASELINE_EMPTY",
		]);
	});
});
