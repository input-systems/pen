import { describe, expect, it } from "vitest";
import type { Editor, UndoManager } from "@input/pen-types";

import {
	resolveDefaultKeymap,
	type DefaultKeymapBinding,
	type KeymapPlatform,
} from "..";
import { caretOf, createCommandEditor, liveRegistry } from "./fixture";

/**
 * I6 headless half. Iterates the default keymap table and dispatches each
 * binding through the registry `createEditor` installed.
 *
 * This is not browser parity and does not compare `createEditor` to
 * `createHeadlessEditor` — those are the same factory in Node. The browser
 * harness half (real key events, rule I6) is outstanding.
 */

function twoParagraphs(): Editor {
	return createCommandEditor([
		{ id: "a", type: "paragraph", text: "aa hello" },
		{ id: "b", type: "paragraph", text: "bbb world" },
	]);
}

function installUndo(editor: Editor): void {
	const manager: UndoManager = {
		undo: () => true,
		redo: () => true,
		canUndo: () => true,
		canRedo: () => true,
		stopCapturing: () => {},
		withCapture: (_origin, _groupId, run) => run(),
		setGroupTimeout: () => {},
		registerTrackedOrigins: () => () => {},
		onStackChange: () => () => {},
	};
	editor.internals.assignSlot("undo:manager", manager);
}

function setupFor(binding: DefaultKeymapBinding): Editor {
	switch (binding.command.name) {
		case "pen.caretLeft":
		case "pen.caretWordLeft":
		case "pen.caretLineStart":
		case "pen.caretDocStart": {
			const editor = twoParagraphs();
			editor.selectText("b", 4, 4);
			return editor;
		}
		case "pen.caretRight":
		case "pen.caretWordRight":
		case "pen.caretLineEnd":
		case "pen.caretDocEnd": {
			const editor = twoParagraphs();
			editor.selectText("a", 0, 0);
			return editor;
		}
		case "pen.caretUp": {
			const editor = twoParagraphs();
			editor.selectText("b", 0, 0);
			return editor;
		}
		case "pen.caretDown": {
			const editor = twoParagraphs();
			editor.selectText("a", 8, 8);
			return editor;
		}
		case "pen.deleteBackward":
		case "pen.deleteForward": {
			const editor = createCommandEditor([
				{ id: "a", type: "paragraph", text: "hello world" },
			]);
			editor.selectText("a", 5, 5);
			return editor;
		}
		case "pen.splitBlock":
		case "pen.insertLineBreak": {
			const editor = createCommandEditor([
				{ id: "a", type: "paragraph", text: "hello" },
			]);
			editor.selectText("a", 2, 2);
			return editor;
		}
		case "pen.indent": {
			const editor = createCommandEditor([
				{ id: "a", type: "bulletListItem", text: "one" },
				{ id: "b", type: "bulletListItem", text: "two" },
			]);
			editor.selectText("b", 0, 0);
			return editor;
		}
		case "pen.outdent": {
			const editor = createCommandEditor([
				{ id: "a", type: "bulletListItem", text: "one" },
				{
					id: "b",
					type: "bulletListItem",
					text: "two",
					props: { indent: 1 },
				},
			]);
			editor.selectText("b", 0, 0);
			return editor;
		}
		case "pen.selectAll": {
			const editor = twoParagraphs();
			editor.selectText("a", 1, 1);
			return editor;
		}
		case "pen.toggleMark": {
			const editor = createCommandEditor([
				{ id: "a", type: "paragraph", text: "hello" },
			]);
			editor.selectText("a", 0, 5);
			return editor;
		}
		case "history.undo":
		case "history.redo": {
			const editor = twoParagraphs();
			editor.selectText("a", 0, 0);
			installUndo(editor);
			return editor;
		}
		case "table.cellNext":
		case "table.cellPrev":
		case "table.cellDown": {
			const editor = createCommandEditor([{ id: "t", type: "table" }]);
			editor.selectCell("t", 0, 0);
			return editor;
		}
		default:
			throw new Error(
				`I6 headless: no fixture for ${binding.command.name}`,
			);
	}
}

function dispatchBinding(binding: DefaultKeymapBinding): boolean {
	const editor = setupFor(binding);
	const handled = liveRegistry(editor).dispatch(
		binding.command,
		binding.param as never,
	);
	editor.destroy();
	return handled;
}

function catalogKeys(platform: KeymapPlatform): string[] {
	return resolveDefaultKeymap(platform).map(
		(binding) => `${binding.key}->${binding.command.name}`,
	);
}

describe("I6 headless keymap catalog", () => {
	it("I6 headless: every macos default keymap entry dispatches on the live registry", () => {
		const handled: Record<string, boolean> = {};
		for (const binding of resolveDefaultKeymap("macos")) {
			handled[`${binding.key}->${binding.command.name}`] =
				dispatchBinding(binding);
		}
		expect(Object.keys(handled).sort()).toEqual(
			catalogKeys("macos").sort(),
		);
		expect(Object.values(handled).every(Boolean)).toBe(true);
	});

	it("I6 headless: every windows default keymap entry dispatches on the live registry", () => {
		const handled: Record<string, boolean> = {};
		for (const binding of resolveDefaultKeymap("windows")) {
			handled[`${binding.key}->${binding.command.name}`] =
				dispatchBinding(binding);
		}
		expect(Object.keys(handled).sort()).toEqual(
			catalogKeys("windows").sort(),
		);
		expect(Object.values(handled).every(Boolean)).toBe(true);
	});

	it("I6 headless: ArrowUp/Down produce the same doc+selection as caretUp/Down", () => {
		const down = resolveDefaultKeymap("macos").find(
			(binding) => binding.key === "ArrowDown",
		);
		const up = resolveDefaultKeymap("macos").find(
			(binding) => binding.key === "ArrowUp",
		);
		if (!down || !up) {
			throw new Error("missing vertical bindings");
		}

		const editor = setupFor(down);
		expect(
			liveRegistry(editor).dispatch(down.command, down.param as never),
		).toBe(true);
		expect(caretOf(editor)).toEqual({ blockId: "b", offset: 0 });
		expect(editor.getBlock("a")?.textContent()).toBe("aa hello");
		editor.destroy();

		const editorUp = setupFor(up);
		expect(
			liveRegistry(editorUp).dispatch(up.command, up.param as never),
		).toBe(true);
		expect(caretOf(editorUp)).toEqual({ blockId: "a", offset: 8 });
		editorUp.destroy();
	});

	it("I6 headless: Backspace/Delete mutate the document at grapheme granularity", () => {
		const backspace = resolveDefaultKeymap("macos").find(
			(binding) => binding.key === "Backspace",
		);
		const del = resolveDefaultKeymap("macos").find(
			(binding) => binding.key === "Delete",
		);
		if (!backspace || !del) {
			throw new Error("missing delete bindings");
		}

		const editor = setupFor(backspace);
		expect(
			liveRegistry(editor).dispatch(
				backspace.command,
				backspace.param as never,
			),
		).toBe(true);
		expect(editor.getBlock("a")?.textContent()).toBe("hell world");
		expect(caretOf(editor)).toEqual({ blockId: "a", offset: 4 });
		editor.destroy();

		const editorFwd = setupFor(del);
		expect(
			liveRegistry(editorFwd).dispatch(del.command, del.param as never),
		).toBe(true);
		expect(editorFwd.getBlock("a")?.textContent()).toBe("helloworld");
		expect(caretOf(editorFwd)).toEqual({ blockId: "a", offset: 5 });
		editorFwd.destroy();
	});

	it("I6 headless: Enter splits and Shift-Enter inserts a line break", () => {
		const enter = resolveDefaultKeymap("macos").find(
			(binding) => binding.key === "Enter" && !binding.context,
		);
		const shiftEnter = resolveDefaultKeymap("macos").find(
			(binding) => binding.key === "Shift-Enter",
		);
		if (!enter || !shiftEnter) {
			throw new Error("missing enter bindings");
		}

		const splitEditor = setupFor(enter);
		expect(
			liveRegistry(splitEditor).dispatch(
				enter.command,
				enter.param as never,
			),
		).toBe(true);
		expect(splitEditor.getBlock("a")?.textContent()).toBe("he");
		expect(caretOf(splitEditor).offset).toBe(0);
		expect(caretOf(splitEditor).blockId).not.toBe("a");
		splitEditor.destroy();

		const breakEditor = setupFor(shiftEnter);
		expect(
			liveRegistry(breakEditor).dispatch(
				shiftEnter.command,
				shiftEnter.param as never,
			),
		).toBe(true);
		expect(breakEditor.getBlock("a")?.textContent()).toBe("he\nllo");
		breakEditor.destroy();
	});

	it("I6 headless: Mod-b formats a selected range (collapsed caret is a miss)", () => {
		const bold = resolveDefaultKeymap("macos").find(
			(binding) => binding.key === "Meta-b",
		);
		if (!bold) {
			throw new Error("missing bold binding");
		}

		const ranged = setupFor(bold);
		expect(
			liveRegistry(ranged).dispatch(bold.command, bold.param as never),
		).toBe(true);
		expect(ranged.getBlock("a")?.textDeltas()).toEqual([
			{ insert: "hello", attributes: { bold: true } },
		]);
		ranged.destroy();

		const collapsed = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hello" },
		]);
		collapsed.selectText("a", 2, 2);
		expect(
			liveRegistry(collapsed).dispatch(bold.command, bold.param as never),
		).toBe(false);
		expect(collapsed.getBlock("a")?.textDeltas()).toEqual([
			{ insert: "hello" },
		]);
		collapsed.destroy();
	});
});
