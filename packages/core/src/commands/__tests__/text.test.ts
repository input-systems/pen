import { describe, expect, it } from "vitest";

import {
	convertBlock,
	deleteBackward,
	deleteForward,
	indent,
	insertLineBreak,
	insertText,
	outdent,
	splitBlock,
	toggleMark,
} from "..";
import { caretOf, createCommandEditor, createCommandHarness } from "./fixture";

describe("text commands", () => {
	it("F2: backspace at an emoji deletes the whole grapheme", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hi👋z" },
		]);
		const registry = createCommandHarness(editor);
		const afterEmoji = "hi👋".length;
		editor.selectText("a", afterEmoji, afterEmoji);

		expect(
			registry.dispatch(deleteBackward, { granularity: "grapheme" }),
		).toBe(true);
		expect(editor.getBlock("a")?.textContent()).toBe("hiz");
		expect(caretOf(editor)).toEqual({ blockId: "a", offset: 2 });
		editor.destroy();
	});

	it("delete at block boundaries merges per schema flow", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "Hello" },
			{ id: "b", type: "paragraph", text: "World" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("b", 0, 0);

		expect(
			registry.dispatch(deleteBackward, { granularity: "grapheme" }),
		).toBe(true);
		expect(editor.getBlock("a")?.textContent()).toBe("HelloWorld");
		expect(editor.getBlock("b")).toBeNull();
		expect(caretOf(editor)).toEqual({ blockId: "a", offset: 5 });
		editor.destroy();
	});

	it("backspace in an empty first code block converts it to a paragraph", () => {
		const editor = createCommandEditor([{ id: "a", type: "codeBlock" }]);
		const registry = createCommandHarness(editor);
		editor.selectText("a", 0, 0);

		expect(
			registry.dispatch(deleteBackward, { granularity: "grapheme" }),
		).toBe(true);
		expect(editor.getBlock("a")?.type).toBe("paragraph");
		expect(caretOf(editor)).toEqual({ blockId: "a", offset: 0 });
		editor.destroy();
	});

	it("backspace in an empty code block after another block converts it to a paragraph", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "Hello" },
			{ id: "b", type: "codeBlock" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("b", 0, 0);

		expect(
			registry.dispatch(deleteBackward, { granularity: "grapheme" }),
		).toBe(true);
		expect(editor.getBlock("b")?.type).toBe("paragraph");
		expect(editor.getBlock("a")?.textContent()).toBe("Hello");
		expect(caretOf(editor)).toEqual({ blockId: "b", offset: 0 });
		editor.destroy();
	});

	it("backspace at the start of a code block with text merges it into the previous block", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "Hello" },
			{ id: "b", type: "codeBlock", text: "code" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("b", 0, 0);

		expect(
			registry.dispatch(deleteBackward, { granularity: "grapheme" }),
		).toBe(true);
		expect(editor.getBlock("a")?.textContent()).toBe("Hellocode");
		expect(editor.getBlock("b")).toBeNull();
		expect(caretOf(editor)).toEqual({ blockId: "a", offset: 5 });
		editor.destroy();
	});

	it("forward delete at a block end merges the next text block", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "Hello" },
			{ id: "b", type: "paragraph", text: "World" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("a", 5, 5);

		expect(
			registry.dispatch(deleteForward, { granularity: "grapheme" }),
		).toBe(true);
		expect(editor.getBlock("a")?.textContent()).toBe("HelloWorld");
		expect(editor.getBlock("b")).toBeNull();
		expect(caretOf(editor)).toEqual({ blockId: "a", offset: 5 });
		editor.destroy();
	});

	it("delete at a structural neighbor selects the block instead of merging", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "Hello" },
			{ id: "div", type: "divider" },
			{ id: "b", type: "paragraph", text: "World" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("b", 0, 0);

		expect(
			registry.dispatch(deleteBackward, { granularity: "grapheme" }),
		).toBe(true);
		expect(editor.getBlock("b")?.textContent()).toBe("World");
		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["div"],
			head: "div",
		});
		editor.destroy();
	});

	it("split inside a list continues the list", () => {
		const editor = createCommandEditor([
			{ id: "li", type: "bulletListItem", text: "onetwo" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("li", 3, 3);

		expect(registry.dispatch(splitBlock, undefined)).toBe(true);
		expect(editor.getBlock("li")?.textContent()).toBe("one");
		expect(editor.getBlock("li")?.type).toBe("bulletListItem");
		const next = caretOf(editor);
		expect(next.offset).toBe(0);
		expect(next.blockId).not.toBe("li");
		expect(editor.getBlock(next.blockId)?.type).toBe("bulletListItem");
		expect(editor.getBlock(next.blockId)?.textContent()).toBe("two");
		editor.destroy();
	});

	it("an empty list item outdents", () => {
		const editor = createCommandEditor([
			{ id: "li", type: "bulletListItem" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("li", 0, 0);

		expect(registry.dispatch(splitBlock, undefined)).toBe(true);
		expect(editor.getBlock("li")?.type).toBe("paragraph");
		editor.destroy();
	});

	it("insertText uses explicit marks instead of inherited caret marks", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "Hi" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("a", 2, 2);

		expect(
			registry.dispatch(insertText, {
				text: "X",
				marks: { italic: true },
			}),
		).toBe(true);
		expect(editor.getBlock("a")?.textDeltas()).toEqual([
			{ insert: "Hi" },
			{ insert: "X", attributes: { italic: true } },
		]);
		editor.destroy();
	});

	it("insertText replaces the current text selection", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hello" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("a", 1, 4);

		expect(registry.dispatch(insertText, { text: "i" })).toBe(true);
		expect(editor.getBlock("a")?.textContent()).toBe("hio");
		expect(caretOf(editor)).toEqual({ blockId: "a", offset: 2 });
		editor.destroy();
	});

	it("insertLineBreak inserts a soft break", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "ab" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("a", 1, 1);

		expect(registry.dispatch(insertLineBreak, undefined)).toBe(true);
		expect(editor.getBlock("a")?.textContent()).toBe("a\nb");
		editor.destroy();
	});

	it("splitBlock on a heading continues as a paragraph", () => {
		const editor = createCommandEditor([
			{ id: "h", type: "heading", text: "Title", props: { level: 2 } },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("h", 5, 5);

		expect(registry.dispatch(splitBlock, undefined)).toBe(true);
		const next = caretOf(editor);
		expect(editor.getBlock("h")?.type).toBe("heading");
		expect(editor.getBlock(next.blockId)?.type).toBe("paragraph");
		editor.destroy();
	});

	it("indent and outdent change list indent when a previous sibling allows it", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "bulletListItem", text: "one" },
			{ id: "b", type: "bulletListItem", text: "two" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("b", 0, 0);

		expect(registry.dispatch(indent, undefined)).toBe(true);
		expect(editor.getBlock("b")?.props.indent).toBe(1);
		expect(registry.dispatch(outdent, undefined)).toBe(true);
		expect(editor.getBlock("b")?.props.indent).toBe(0);
		expect(registry.dispatch(outdent, undefined)).toBe(false);
		editor.destroy();
	});

	it("toggleMark formats a text range", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hello" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("a", 0, 5);

		expect(registry.dispatch(toggleMark, { mark: "bold" })).toBe(true);
		expect(editor.getBlock("a")?.textDeltas()).toEqual([
			{ insert: "hello", attributes: { bold: true } },
		]);
		expect(registry.dispatch(toggleMark, { mark: "bold" })).toBe(true);
		expect(editor.getBlock("a")?.textDeltas()).toEqual([
			{ insert: "hello" },
		]);
		editor.destroy();
	});

	it("convertBlock wraps convert-block with schema validation", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hi" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("a", 0, 0);

		expect(
			registry.dispatch(convertBlock, {
				blockId: "a",
				newType: "heading",
				newProps: { level: 2 },
			}),
		).toBe(true);
		expect(editor.getBlock("a")?.type).toBe("heading");
		expect(
			registry.dispatch(convertBlock, {
				blockId: "a",
				newType: "not-a-block",
			}),
		).toBe(false);
		editor.destroy();
	});

	it("word and line delete use segmentation, not UTF-16 units", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hello world" },
		]);
		const registry = createCommandHarness(editor);
		editor.selectText("a", 11, 11);

		expect(registry.dispatch(deleteBackward, { granularity: "word" })).toBe(
			true,
		);
		expect(editor.getBlock("a")?.textContent()).toBe("hello ");

		editor.selectText("a", 6, 6);
		expect(registry.dispatch(deleteBackward, { granularity: "line" })).toBe(
			true,
		);
		expect(editor.getBlock("a")?.textContent()).toBe("");
		editor.destroy();
	});
});
