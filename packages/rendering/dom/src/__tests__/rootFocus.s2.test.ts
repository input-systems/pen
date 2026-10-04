// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DocumentOp } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { mountEditor } from "../host/mountEditor";
import { DATA_ATTRS } from "../utils/dataAttributes";

const BLOCK_TEXTS = ["One", "Two", "Three"] as const;

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

/** A mounted three-paragraph editor; nothing in it has focus. */
function mount() {
	const editor = createEditor({ schema: defaultSchema });
	const firstId = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [
		{ type: "splice-text", blockId: firstId, from: 0, to: 0, insert: "One" },
	];
	const blockIds = [firstId];
	for (const text of BLOCK_TEXTS.slice(1)) {
		const blockId = `block-${text}`;
		blockIds.push(blockId);
		ops.push(
			{
				type: "insert-block",
				blockId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{ type: "splice-text", blockId, from: 0, to: 0, insert: text },
		);
	}
	editor.apply(ops);
	const root = document.createElement("div");
	document.body.append(root);
	const mounted = mountEditor(editor, root);
	cleanups.push(() => {
		mounted.destroy();
		editor.destroy();
	});
	return { editor, root, blockIds };
}

function blockIdOf(node: Node | null | undefined): string | null {
	const element = node instanceof Element ? node : node?.parentElement;
	return (
		element
			?.closest(`[${DATA_ATTRS.blockId}]`)
			?.getAttribute(DATA_ATTRS.blockId) ?? null
	);
}

describe("focus entering the root projects the record (S2, P)", () => {
	it("S2: Tab into a multi-block range under the block-surface threshold projects it into the expanded host", () => {
		const { editor, root, blockIds } = mount();
		const [first, , last] = blockIds;
		editor.setSelection({
			type: "text",
			anchor: { blockId: first!, offset: 1 },
			focus: { blockId: last!, offset: 2 },
		});
		expect(document.activeElement).toBe(document.body);

		root.focus();

		const host = root.querySelector(`[${DATA_ATTRS.editorBlocksHost}]`);
		expect(host).not.toBeNull();
		expect(document.activeElement).toBe(host);
		const selection = document.getSelection()!;
		expect(selection.rangeCount).toBe(1);
		expect(blockIdOf(selection.anchorNode)).toBe(first);
		expect(blockIdOf(selection.focusNode)).toBe(last);
	});

	it("S2: Tab into a single-block caret still focuses that block's field", () => {
		const { editor, root, blockIds } = mount();
		const middle = blockIds[1]!;
		editor.selectText(middle, 1, 1);

		root.focus();

		expect(document.activeElement).not.toBe(root);
		expect(blockIdOf(document.activeElement)).toBe(middle);
	});
});
