import {
	createScanProbe,
	createTestEditor,
	generateMixedBlockSpecs,
	mixedFixtureOps,
	mixedFixtureTargets,
	type ScanCounts,
	type TestEditor,
} from "@input/pen-test";
import { describe, expect, it } from "vitest";

/**
 * SCALE2 (W2.G3): one keystroke and one caret move on the default stack read
 * the same document entries whatever the document size. Counts, not clocks.
 */
const SIZES = [100, 1_000, 5_000] as const;
const WARMUP = 3;

function buildMixed(rootCount: number): TestEditor {
	const editor = createTestEditor({ blocks: generateMixedBlockSpecs(rootCount) });
	editor.apply(mixedFixtureOps(rootCount), { origin: "system" });
	return editor;
}

function type(editor: TestEditor, blockId: string): void {
	const at = editor.getBlock(blockId)?.textContent().length ?? 0;
	editor.apply([{ type: "splice-text", blockId, from: at, to: at, insert: "x" }], {
		origin: "user",
	});
	editor.selectText(blockId, at + 1, at + 1);
}

function caretLeft(editor: TestEditor, blockId: string): void {
	const selection = editor.selection;
	const at = selection?.type === "text" ? selection.anchor.offset : 1;
	editor.selectText(blockId, at - 1, at - 1);
}

function measure(rootCount: number): { keystroke: ScanCounts; caretMove: ScanCounts } {
	const editor = buildMixed(rootCount);
	const { paragraph } = mixedFixtureTargets(rootCount);
	for (let rep = 0; rep < WARMUP; rep += 1) type(editor, paragraph);
	const probe = createScanProbe(editor);
	try {
		probe.selfTest();
		probe.reset();
		type(editor, paragraph);
		const keystroke = probe.snapshot();
		probe.reset();
		caretLeft(editor, paragraph);
		return { keystroke, caretMove: probe.snapshot() };
	} finally {
		probe.dispose();
		editor.destroy();
	}
}

describe("SCALE2 keystroke scan", () => {
	it("SCALE2: a keystroke and a caret move read the same document entries at 100, 1,000 and 5,000 blocks", () => {
		const [small, ...rest] = SIZES.map(measure);
		for (const counts of rest) expect(counts).toEqual(small);
	}, 120_000);
});
