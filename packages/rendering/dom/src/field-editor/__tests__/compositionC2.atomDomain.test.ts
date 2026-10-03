// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { extractTextFromDOM } from "../selectionBridge";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

/** `ab` + mention + `cd` in a contenteditable field (logical text `ab￼cd`). */
function mountAtomField() {
	delete (globalThis as { EditContext?: unknown }).EditContext;
	const editor = createEditor({ schema: defaultSchema });
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "abcd" },
		{
			type: "splice-text",
			blockId,
			from: 2,
			to: 2,
			insert: { nodeType: "mention", props: { id: "1", label: "Ada" } },
		},
	]);
	const fieldEditor = new FieldEditorImpl(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.appendChild(root);
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	block.appendChild(inline);
	root.appendChild(block);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockId);
	cleanups.push(() => {
		fieldEditor.destroy();
		root.remove();
		editor.destroy();
	});
	return { editor, inline, blockId };
}

/** The text node that holds `cd`, after the atom. */
function textAfterAtom(inline: HTMLElement): Text {
	const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		if (node.data.includes("cd")) return node;
	}
	throw new Error("no text node after the atom");
}

describe("C2 composition in a block with an inline atom", () => {
	it("C2: a composition in a block holding an inline atom diffs in the logical domain", () => {
		const { editor, inline, blockId } = mountAtomField();
		expect(extractTextFromDOM(inline)).toBe("ab￼cd");
		editor.selectText(blockId, 3, 3, { origin: "keyboard" });

		inline.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		const after = textAfterAtom(inline);
		after.insertData(after.data.indexOf("cd"), "x");
		inline.dispatchEvent(
			new CompositionEvent("compositionend", { bubbles: true, data: "x" }),
		);

		const deltas = editor.getBlock(blockId)!.inlineDeltas();
		const shape = deltas.map((delta) =>
			typeof delta.insert === "string" ? delta.insert : `<${(delta.insert as { type: string }).type}>`,
		);
		expect(shape).toEqual(["ab", "<mention>", "xcd"]);
		expect(editor.getBlock(blockId)!.length()).toBe(6);
		expect(extractTextFromDOM(inline)).toBe("ab￼xcd");
	});
});
