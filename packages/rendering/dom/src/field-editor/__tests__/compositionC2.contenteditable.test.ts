// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { extractTextFromDOM } from "../selectionBridge";

type Editor = ReturnType<typeof createEditor>;

const fixtures: Array<{
	editors: Editor[];
	fieldEditor: FieldEditorImpl;
	root: HTMLElement;
}> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		const fixture = fixtures.pop();
		if (!fixture) {
			break;
		}
		fixture.fieldEditor.destroy();
		fixture.root.remove();
		for (const editor of fixture.editors) {
			editor.destroy();
		}
	}
});

function mountContentEditableEditor(text: string) {
	delete (globalThis as { EditContext?: unknown }).EditContext;

	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new FieldEditorImpl(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.appendChild(root);
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: text },
	]);
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = text;
	block.appendChild(inline);
	root.appendChild(block);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockId);
	const fixture = { editors: [editor], fieldEditor, root };
	fixtures.push(fixture);
	return { editor, inline, blockId, fixture };
}

function compose(inline: HTMLElement, text: string, during: () => void) {
	inline.dispatchEvent(
		new CompositionEvent("compositionstart", { bubbles: true }),
	);
	inline.append(text);
	during();
	inline.dispatchEvent(
		new CompositionEvent("compositionend", { bubbles: true, data: text }),
	);
}

/**
 * Applies `X` at offset 0 of `blockId` on a second editor that shares the
 * document's state, then delivers it through `applyUpdate`, so the receiving
 * `Y.Text` observer sees `transaction.local === false` the way a provider's
 * update arrives.
 */
function applyRemoteInsert(local: Editor, blockId: string, track: Editor[]) {
	const peer = createEditor({ schema: defaultSchema });
	track.push(peer);
	const encode = (editor: Editor) =>
		editor.internals.adapter.encodeUpdate(editor.internals.crdtDoc);
	peer.internals.adapter.applyUpdate(peer.internals.crdtDoc, encode(local));
	peer.apply(
		[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
		{ origin: "user" },
	);
	local.internals.adapter.applyUpdate(local.internals.crdtDoc, encode(peer));
}

describe("C2 contenteditable mid-composition remote", () => {

	it("C2 COL1: contenteditable defers a delta that arrives through applyUpdate", () => {
		const { editor, inline, blockId, fixture } =
			mountContentEditableEditor("Hello world");

		compose(inline, "ni", () => {
			applyRemoteInsert(editor, blockId, fixture.editors);
		});

		const text = editor.getBlock(blockId)?.textContent();
		expect(text).toBe("XHello worldni");
		expect(extractTextFromDOM(inline)).toBe(text);
	});
});
