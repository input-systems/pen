// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
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

	/** A `textupdate` as the browser reports it, range and caret included. */
	textUpdate(start: number, end: number, text: string): void {
		const event = Object.assign(new Event("textupdate"), {
			updateRangeStart: start,
			updateRangeEnd: end,
			text,
			selectionStart: start + text.length,
			selectionEnd: start + text.length,
		});
		for (const handler of this.listeners.get("textupdate") ?? []) {
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

describe("FE9 EditContext trusted typing caret", () => {
	it("FE9: a mapped selectionChange clears the backend's trusted typing caret and the next textupdate inserts at the mapped caret", () => {
		const { editor, fieldEditor, blockId, inline } =
			mountEditContextEditor("hello world");
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext!;

		fieldEditor.activateTextSelection(blockId, 5, 5);
		editContext.textUpdate(5, 5, "x");
		expect(editor.getBlock(blockId)?.textContent()).toBe("hellox world");

		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 3, insert: "" }],
			{ origin: "user" },
		);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId, offset: 3 },
		});
		expect(editContext.selectionStart).toBe(3);
		expect(editContext.selectionEnd).toBe(3);

		// a stale range: the pre-apply caret would put "y" at 6
		editContext.textUpdate(6, 6, "y");
		expect(editor.getBlock(blockId)?.textContent()).toBe("loxy world");
	});

	it("FE9: an ordinary selection change keeps the trusted typing caret", () => {
		const { editor, fieldEditor, blockId, inline } =
			mountEditContextEditor("hello world");
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext!;

		fieldEditor.activateTextSelection(blockId, 5, 5);
		editContext.textUpdate(5, 5, "x");

		// not a mapped remap, so the caret is still the last trusted typing
		// caret a stale EditContext range resolves against
		editor.selectText(blockId, 2, 2);
		editContext.textUpdate(9, 9, "y");

		expect(editor.getBlock(blockId)?.textContent()).toBe("helloxy world");
	});
});
