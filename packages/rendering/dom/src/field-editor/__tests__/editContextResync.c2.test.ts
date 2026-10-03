// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { extractTextFromDOM } from "../selectionBridge";
import type { EditContext } from "../editContextTypes";

class FakeEditContext implements EditContext {
	text: string;
	selectionStart: number;
	selectionEnd: number;
	private readonly listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(options?: {
		text?: string;
		selectionStart?: number;
		selectionEnd?: number;
	}) {
		this.text = options?.text ?? "";
		this.selectionStart = options?.selectionStart ?? 0;
		this.selectionEnd = options?.selectionEnd ?? 0;
	}

	readonly updateTextCalls: Array<[number, number, string]> = [];

	updateText(start: number, end: number, text: string): void {
		this.updateTextCalls.push([start, end, text]);
		this.text = `${this.text.slice(0, start)}${text}${this.text.slice(end)}`;
	}

	updateSelection(start: number, end: number): void {
		this.selectionStart = start;
		this.selectionEnd = end;
	}

	updateCharacterBounds(): void {}

	addEventListener(type: string, handler: (event: Event) => void): void {
		const handlers = this.listeners.get(type) ?? new Set();
		handlers.add(handler);
		this.listeners.set(type, handlers);
	}

	removeEventListener(type: string, handler: (event: Event) => void): void {
		this.listeners.get(type)?.delete(handler);
	}

	emit(type: string, event: Event): void {
		for (const handler of this.listeners.get(type) ?? []) {
			handler(event);
		}
	}
}

const fixtures: Array<{
	editor: ReturnType<typeof createEditor>;
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
		fixture.editor.destroy();
	}
	delete (globalThis as { EditContext?: unknown }).EditContext;
});

function mountEditContextEditor(text: string) {
	(
		globalThis as typeof globalThis & {
			EditContext: typeof FakeEditContext;
		}
	).EditContext = FakeEditContext;

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
	fixtures.push({ editor, fieldEditor, root });
	return { editor, fieldEditor, root, blockId, inline };
}

function textUpdate(init: {
	updateRangeStart: number;
	updateRangeEnd: number;
	text: string;
	selectionStart: number;
	selectionEnd: number;
}): Event {
	return Object.assign(new Event("textupdate"), init);
}

function contextOf(inline: HTMLElement): FakeEditContext {
	return (inline as HTMLElement & { editContext?: FakeEditContext }).editContext!;
}

describe("C2 EditContext rebase", () => {
	it("C2: EditContext resyncs its buffer with one updateText over the changed span", () => {
		const { editor, inline, blockId } = mountEditContextEditor("Hello world");
		const editContext = contextOf(inline);
		inline.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		editor.apply(
			[{ type: "splice-text", blockId, from: 5, to: 5, insert: "XX" }],
			{ origin: "collaborator" },
		);
		editContext.updateTextCalls.length = 0;

		inline.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));

		expect(editContext.updateTextCalls).toEqual([[5, 5, "XX"]]);
		expect(editContext.text).toBe("HelloXX world");
		expect(editor.getBlock(blockId)?.textContent()).toBe("HelloXX world");
	});

	it("C2: EditContext textupdate ranges map through remote deltas that arrive mid-composition", () => {
		const { editor, inline, blockId } = mountEditContextEditor("Hello world");
		const editContext = contextOf(inline);
		editor.selectText(blockId, 11, 11, { origin: "keyboard" });
		inline.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
		// A peer prepends while the IME composes at the end of the buffer.
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
			{ origin: "collaborator" },
		);
		expect(editContext.text).toBe("Hello world");

		editContext.emit(
			"textupdate",
			textUpdate({
				updateRangeStart: 11,
				updateRangeEnd: 11,
				text: "!",
				selectionStart: 12,
				selectionEnd: 12,
			}),
		);

		// Buffer offset 11 is Y.Text offset 12 once the remote "X" is in.
		expect(editor.getBlock(blockId)?.textContent()).toBe("XHello world!");
	});

	it("C2: an EditContext composition committed after a remote insert lands at its mapped range", () => {
		const { editor, inline, blockId } = mountEditContextEditor("Hello world");
		const editContext = contextOf(inline);
		editor.selectText(blockId, 11, 11, { origin: "keyboard" });
		// Chromium: the first textupdate applies speculatively, then the
		// textformatupdate opens the composition and rewinds it into pending.
		editContext.emit(
			"textupdate",
			textUpdate({ updateRangeStart: 11, updateRangeEnd: 11, text: "か", selectionStart: 12, selectionEnd: 12 }),
		);
		editContext.emit(
			"textformatupdate",
			Object.assign(new Event("textformatupdate"), { getTextFormats: () => [] }),
		);
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
			{ origin: "collaborator" },
		);
		editContext.emit(
			"textupdate",
			textUpdate({ updateRangeStart: 11, updateRangeEnd: 12, text: "漢", selectionStart: 12, selectionEnd: 12 }),
		);

		expect(editor.getBlock(blockId)?.textContent()).toBe("XHello world漢");
		const selection = editor.selection;
		expect(selection?.type === "text" ? selection.focus.offset : null).toBe(13);
	});
});

