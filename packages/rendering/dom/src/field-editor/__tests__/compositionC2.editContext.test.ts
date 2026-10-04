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

	updateText(start: number, end: number, text: string): void {
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

describe("C2 EditContext mid-composition remote", () => {

	it("C2: EditContext field DOM untouched after the EditContext compositionstart", () => {
		const { editor, inline, blockId } =
			mountEditContextEditor("Hello world");
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext;
		expect(editContext).toBeDefined();
		// Chromium fires composition events on the EditContext, not the
		// element; a bare textformatupdate no longer opens a composition (C1).
		editContext!.emit(
			"compositionstart",
			new CompositionEvent("compositionstart", { data: "" }),
		);
		inline.append("ni");
		const beforeDom = extractTextFromDOM(inline);

		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
			{ origin: "collaborator" },
		);

		expect(
			extractTextFromDOM(inline),
			"C2: EditContext field DOM untouched during remote commit",
		).toBe(beforeDom);
		expect(
			editor.getBlock(blockId)?.textContent()?.includes("XHello"),
			"C2: EditContext authority accepted the remote insert",
		).toBe(true);
	});

	it("C2: EditContext resyncs its buffer from the document after a deferred collaborator delta", () => {
		const { editor, inline, blockId } =
			mountEditContextEditor("Hello world");
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext!;
		inline.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true }),
		);

		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "X" }],
			{ origin: "collaborator" },
		);
		expect(editContext.text).toBe("Hello world");

		inline.dispatchEvent(
			new CompositionEvent("compositionend", { bubbles: true, data: "" }),
		);

		const text = editor.getBlock(blockId)?.textContent();
		expect(text).toBe("XHello world");
		expect(editContext.text).toBe(text);
		expect(extractTextFromDOM(inline)).toBe(text);
	});
});
