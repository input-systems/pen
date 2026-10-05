import { describe, expect, it } from "vitest";

import { createTestEditor } from "../createTestEditor";
import {
	MIXED_FIXTURE_SIZES,
	generateMixedBlockSpecs,
	mixedFixtureIdentity,
	mixedFixtureOps,
	mixedFixtureTargets,
} from "../fixtures/scale/mixed";

function rootIds(editor: ReturnType<typeof createTestEditor>): string[] {
	return editor.documentState.blockOrder.filter(
		(id) => !editor.getBlock(id)?.props.parentId,
	);
}

function buildMixed(rootCount: number) {
	const editor = createTestEditor({ blocks: generateMixedBlockSpecs(rootCount) });
	editor.apply(mixedFixtureOps(rootCount), { origin: "system" });
	return editor;
}

describe("SCALE1 mixed scale fixture", () => {
	it("SCALE1: the 1k mixed fixture has the identity its arithmetic states", () => {
		const editor = buildMixed(1_000);
		const identity = mixedFixtureIdentity(1_000);
		const blockOrder = editor.documentState.blockOrder;

		expect(identity).toMatchObject({
			rootCount: 1_000,
			blockOrderLength: 1_050,
			totalBlocks: 1_050,
			tableCount: 1,
		});
		expect(blockOrder.length).toBe(identity.blockOrderLength);
		expect(rootIds(editor).length).toBe(identity.rootCount);
		expect(editor.blockCount()).toBe(identity.totalBlocks);

		const counted: Record<string, number> = {};
		for (const id of rootIds(editor)) {
			const type = editor.getBlock(id)!.type;
			counted[type] = (counted[type] ?? 0) + 1;
		}
		expect(counted).toEqual(identity.composition);
		editor.destroy();
	});

	it("SCALE1: the fixture is a pure function of rootCount", () => {
		expect(generateMixedBlockSpecs(1_000)).toEqual(generateMixedBlockSpecs(1_000));
		expect(mixedFixtureOps(1_000)).toEqual(mixedFixtureOps(1_000));
	});

	it("SCALE1: published sizes have the expected identity and reject non-multiples of 20", () => {
		expect(MIXED_FIXTURE_SIZES).toEqual([1_000, 5_000, 10_000, 50_000]);
		expect(
			MIXED_FIXTURE_SIZES.map((size) => {
				const { blockOrderLength, tableCount } = mixedFixtureIdentity(size);
				return [blockOrderLength, tableCount];
			}),
		).toEqual([
			[1_050, 1],
			[5_250, 5],
			[10_500, 10],
			[52_500, 50],
		]);
		expect(() => generateMixedBlockSpecs(1_010)).toThrow(/multiple of 20/);
	});

	it("SCALE1: targets sit on the slots the scripted actions expect", () => {
		const editor = buildMixed(1_000);
		const targets = mixedFixtureTargets(1_000);
		expect(targets.paragraph).toBe("scale-block-501");
		expect(editor.getBlock(targets.paragraph)!.type).toBe("paragraph");
		expect(editor.getBlock(targets.nextParagraph)!.type).toBe("paragraph");
		expect(editor.getBlock(targets.numbered)!.type).toBe("numberedListItem");
		expect(editor.getBlock(targets.insertAfter)!.type).toBe("paragraph");
		editor.destroy();
	});
});
