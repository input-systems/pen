import { applySplitBlock } from "@input/pen-core";
import { describe, expect, it } from "vitest";
import {
	createScanProbe,
	createTestEditor,
	generateMixedBlockSpecs,
	mixedFixtureOps,
	mixedFixtureTargets,
	type ScanCounts,
	type TestEditor,
} from "../index";

// SCALE2 for COL4 Rule 12 (dangling structural entries): the repair reads
// liveness from the `blocks` walk the pass-index build already does (shared
// with Rules 9 and 11), never from a per-entry `blocks.has`, so it adds no
// blocks-map read on any commit. A per-entry lookup showed up as one extra
// read per block on every pass-index rebuild.
const SIZES = [100, 5_000] as const;
const WARMUP = 3;

function buildMixed(rootCount: number): TestEditor {
	const editor = createTestEditor({ blocks: generateMixedBlockSpecs(rootCount) });
	editor.apply(mixedFixtureOps(rootCount), { origin: "system" });
	return editor;
}

function type(editor: TestEditor, blockId: string): void {
	const at = editor.getBlock(blockId).textContent().length;
	editor.apply([{ type: "splice-text", blockId, from: at, to: at, insert: "x" }], {
		origin: "user",
	});
}

type Measured = { blockCount: number; keystroke: ScanCounts; enter: ScanCounts };

function measure(rootCount: number): Measured {
	const editor = buildMixed(rootCount);
	const { paragraph } = mixedFixtureTargets(rootCount);
	for (let rep = 0; rep < WARMUP; rep += 1) type(editor, paragraph);
	applySplitBlock(editor, { blockId: paragraph, offset: 1, newBlockId: "warm-split" });
	const probe = createScanProbe(editor);
	try {
		const blockCount = editor.document.blocks.size;
		probe.selfTest();
		probe.reset();
		// The warm-up split invalidated the pass index, so this keystroke
		// rebuilds it: the rebuild is where a per-entry lookup would show.
		type(editor, paragraph);
		const keystroke = probe.snapshot();
		probe.reset();
		applySplitBlock(editor, { blockId: paragraph, offset: 1, newBlockId: "enter-split" });
		return { blockCount, keystroke, enter: probe.snapshot() };
	} finally {
		probe.dispose();
		editor.destroy();
	}
}

describe("SCALE2 normalization Rule 12", () => {
	it("SCALE2 COL4: dangling-entry repair adds no blocks-map read to a keystroke or an Enter at 100 vs 5,000 blocks", () => {
		const [small, large] = SIZES.map(measure) as [Measured, Measured];
		// A keystroke that rebuilds the pass index reads the same blocks-map
		// entries at both sizes.
		expect(large.keystroke.blocksMapReads).toBe(small.keystroke.blocksMapReads);
		expect(large.keystroke.textFullReads).toBe(small.keystroke.textFullReads);
		// An Enter's only size-proportional blocks-map reads are the change
		// summary's block-index snapshot, one per block (owned by W2, not by
		// normalization); Rule 12 must not add a second read per block.
		expect(large.enter.blocksMapReads - small.enter.blocksMapReads).toBeLessThanOrEqual(
			large.blockCount - small.blockCount,
		);
	}, 120_000);
});
