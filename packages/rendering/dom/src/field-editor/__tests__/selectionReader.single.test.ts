// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import {
	createSelectionReader,
	type ReaderSelection,
} from "../selectionReader";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
	document.body.replaceChildren();
	document.getSelection()?.removeAllRanges();
});

/** An editor whose first block reads "hello", rendered as a minimal root. */
function seed() {
	const editor = createEditor({ schema: defaultSchema });
	editors.push(editor);
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello" },
	]);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("span");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = "hello";
	block.append(inline);
	root.append(block);
	document.body.append(root);
	const placeCaret = (offset: number) => {
		document.getSelection()!.collapse(inline.firstChild, offset);
	};
	return { editor, blockId, root, placeCaret };
}

function caret(blockId: string, offset: number): ReaderSelection {
	return {
		type: "text",
		anchor: { blockId, offset },
		focus: { blockId, offset },
	};
}

describe("single selection reader (S1, W3.R4)", () => {
	it("S1: the reader's one selectionchange listener maps the live selection inside its root", () => {
		const { editor, blockId, root, placeCaret } = seed();
		const read = vi.fn(() => "accept" as const);
		const reader = createSelectionReader({ editor, read });
		reader.attach(root);
		placeCaret(3);
		document.dispatchEvent(new Event("selectionchange"));
		expect(read).toHaveBeenCalledTimes(1);
		expect(read).toHaveBeenCalledWith(caret(blockId, 3));

		reader.detach();
		document.dispatchEvent(new Event("selectionchange"));
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("S1: a selection outside the root is no proposal", () => {
		const { editor, root } = seed();
		const outside = document.createElement("p");
		outside.textContent = "elsewhere";
		document.body.append(outside);
		const read = vi.fn(() => "accept" as const);
		const reader = createSelectionReader({ editor, read });
		reader.attach(root);
		document.getSelection()!.collapse(outside.firstChild, 2);
		expect(reader.sync()).toBe("no-proposal");
		expect(read).not.toHaveBeenCalled();
	});

	it("R: an equivalent read stops at step 3 without the decision or the backend intercept", () => {
		const { editor, blockId, root, placeCaret } = seed();
		editor.selectText(blockId, 2, 2);
		const read = vi.fn(() => "equivalent" as const);
		const intercept = vi.fn(() => true);
		const reader = createSelectionReader({ editor, read, intercept });
		reader.attach(root);
		placeCaret(2);
		expect(reader.sync()).toBe("equivalent");
		expect(intercept).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
	});

	it("R: a read the backend intercept handles never reaches the decision", () => {
		const { editor, blockId, root, placeCaret } = seed();
		editor.selectText(blockId, 0, 0);
		const read = vi.fn(() => "accept" as const);
		const intercept = vi.fn(() => true);
		const reader = createSelectionReader({ editor, read, intercept });
		reader.attach(root);
		placeCaret(4);
		expect(reader.sync()).toBe("no-proposal");
		expect(intercept).toHaveBeenCalledWith(caret(blockId, 4));
		expect(read).not.toHaveBeenCalled();
	});

	it("S1: the reader reads through its DOM port", () => {
		const { editor, blockId, root, placeCaret } = seed();
		placeCaret(1);
		const getSelection = vi.fn((doc: Document) => doc.getSelection());
		const reader = createSelectionReader({
			editor,
			read: () => "accept",
			dom: { getSelection },
		});
		reader.attach(root);
		expect(reader.peek()).toEqual(caret(blockId, 1));
		expect(getSelection).toHaveBeenCalledWith(document);
	});
});
