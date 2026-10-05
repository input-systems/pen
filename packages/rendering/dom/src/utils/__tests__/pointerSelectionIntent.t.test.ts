import {
	buildTransitionSnapshot,
	clickSelectableBlock,
	convertPointerDrag,
	createEditor,
} from "@input/pen-core";
import type { DocumentOp } from "@input/pen-types";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePointerSelectionIntent } from "../pointerSelection";

const fixtures: Array<ReturnType<typeof createEditor>> = [];

afterEach(() => {
	for (const editor of fixtures.splice(0)) editor.destroy();
});

/** "Alpha", a divider `d1`, then paragraphs `p1`… holding "Bravo" until `paragraphs` text blocks exist. */
function createDocument(paragraphs: number) {
	const editor = createEditor({ schema: defaultSchema });
	fixtures.push(editor);
	const first = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [
		{ type: "splice-text", blockId: first, from: 0, to: 0, insert: "Alpha" },
		{ type: "insert-block", blockId: "d1", blockType: "divider", props: {}, position: "last" },
	];
	for (let index = 1; index < paragraphs; index += 1) {
		const blockId = `p${index}`;
		ops.push(
			{ type: "insert-block", blockId, blockType: "paragraph", props: {}, position: "last" },
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Bravo" },
		);
	}
	editor.apply(ops);
	return { editor, first };
}

describe("resolvePointerSelectionIntent", () => {
	it("T2: a drag across a text boundary resolves to convertPointerDrag's result", () => {
		const { editor, first } = createDocument(2);
		const snapshot = buildTransitionSnapshot(editor);
		const anchor = { blockId: first, offset: 2 };
		const focus = { blockId: "p1", offset: 3 };

		const resolved = resolvePointerSelectionIntent(snapshot, { anchor }, { kind: "drag", focus });

		expect(resolved).toEqual(
			convertPointerDrag(
				snapshot,
				{ type: "text", anchor, focus: anchor, affinity: "downstream", goalX: null },
				focus,
			),
		);
		expect(resolved).toMatchObject({ type: "text", anchor, focus });
	});

	it("T2: a drag across a divider stays a text selection", () => {
		const { editor, first } = createDocument(2);
		const snapshot = buildTransitionSnapshot(editor, { blockIds: [first, "d1"] });

		const resolved = resolvePointerSelectionIntent(
			snapshot,
			{ anchor: { blockId: first, offset: 2 } },
			{ kind: "drag", focus: { blockId: "d1", offset: 0 } },
		);

		expect(resolved).toMatchObject({
			type: "text",
			anchor: { blockId: first, offset: 2 },
			focus: { blockId: "d1", offset: 1 },
		});
	});

	it("T3: a 51-block drag never resolves to BlockSelection", () => {
		const { editor, first } = createDocument(51);
		const snapshot = buildTransitionSnapshot(editor);
		expect(snapshot.blockOrder.length).toBeGreaterThan(51);

		const resolved = resolvePointerSelectionIntent(
			snapshot,
			{ anchor: { blockId: first, offset: 0 } },
			{ kind: "drag", focus: { blockId: "p50", offset: 5 } },
		);

		expect(resolved?.type).toBe("text");
	});

	it("T5: clicking a divider resolves through clickSelectableBlock to a BlockSelection with head", () => {
		const { editor } = createDocument(1);
		const snapshot = buildTransitionSnapshot(editor, { blockIds: ["d1"] });

		const resolved = resolvePointerSelectionIntent(
			snapshot,
			{ anchor: null },
			{ kind: "click", blockId: "d1", offset: 0 },
		);

		expect(resolved).toEqual(clickSelectableBlock(snapshot, "d1", 0));
		expect(resolved).toEqual({ type: "block", blockIds: ["d1"], head: "d1" });
	});
});
