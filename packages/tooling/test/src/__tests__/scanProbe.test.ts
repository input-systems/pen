import { describe, expect, it } from "vitest";

import { createTestEditor } from "../createTestEditor";
import { generateMixedBlockSpecs } from "../fixtures/scale/mixed";
import { createScanProbe } from "../scanProbe";

function editorWith(rootCount: number) {
	return createTestEditor({ blocks: generateMixedBlockSpecs(rootCount) });
}

describe("scan probe (SCALE2 instrument)", () => {
	it("SCALE2: the probe's self-test proves every counter is wired", () => {
		const editor = editorWith(100);
		const probe = createScanProbe(editor);
		expect(() => probe.selfTest()).not.toThrow();
		expect(probe.snapshot()).toEqual({
			blockOrderReads: 0,
			blocksMapReads: 0,
			blocksMapIterations: 0,
			textFullReads: 0,
			orderArrayReads: 0,
			documentWalks: 0,
		});
		probe.dispose();
		editor.destroy();
	});

	it("SCALE2: a whole-document walk counts with document size", () => {
		const small = editorWith(100);
		const large = editorWith(1_000);
		const walk = (editor: ReturnType<typeof editorWith>) => {
			const probe = createScanProbe(editor);
			for (const id of editor.documentState.blockOrder) void id;
			const counts = probe.snapshot();
			probe.dispose();
			editor.destroy();
			return counts.orderArrayReads;
		};
		expect(walk(small)).toBe(105);
		// Skeleton only: the table slot is filled by mixedFixtureOps, which this skips.
		expect(walk(large)).toBe(1_049);
	});

	it("SCALE2: another editor's text reads are not counted, and dispose restores everything", () => {
		const probed = editorWith(100);
		const other = editorWith(100);
		const probe = createScanProbe(probed);
		const otherId = other.documentState.blockOrder[0]!;
		String(other.internals.getBlockText(otherId));
		expect(probe.snapshot().textFullReads).toBe(0);

		probe.dispose();
		const id = probed.documentState.blockOrder[0]!;
		String(probed.internals.getBlockText(id));
		void probed.documentState.blockOrder[0];
		expect(probe.snapshot()).toMatchObject({ textFullReads: 0, orderArrayReads: 0 });
		probed.destroy();
		other.destroy();
	});
});
