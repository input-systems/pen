// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { undoExtension } from "@input/pen-undo";
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

function mountEditContextEditor(
	text: string,
	options?: { withUndo?: boolean },
) {
	(
		globalThis as typeof globalThis & {
			EditContext: typeof FakeEditContext;
		}
	).EditContext = FakeEditContext;

	const editor = createEditor({
		schema: defaultSchema,
		extensions: options?.withUndo ? [undoExtension()] : undefined,
	});
	if (options?.withUndo) {
		editor.undoManager.setGroupTimeout(0);
	}
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

function emitTextUpdate(
	editContext: FakeEditContext,
	input: {
		text: string;
		updateRangeStart: number;
		updateRangeEnd: number;
		selectionStart: number;
		selectionEnd: number;
	},
): void {
	editContext.emit(
		"textupdate",
		Object.assign(new Event("textupdate"), input),
	);
}

function emitTextFormatUpdate(editContext: FakeEditContext): void {
	editContext.emit(
		"textformatupdate",
		Object.assign(new Event("textformatupdate"), {
			getTextFormats: () => [],
		}),
	);
}

function authorityText(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): string {
	return editor.getBlock(blockId)?.textContent() ?? "";
}

describe("C1 EditContext composition apply sequencing", () => {
	it("C1: ordinary textupdate applies immediately", () => {
		const { editor, inline, blockId } =
			mountEditContextEditor("Hello world");
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext;
		expect(editContext).toBeDefined();

		emitTextUpdate(editContext!, {
			text: "!",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			selectionStart: 12,
			selectionEnd: 12,
		});

		expect(
			authorityText(editor, blockId).includes("Hello world!"),
			"C1: ordinary textupdate applies immediately",
		).toBe(true);
	});

	it("C1: textformatupdate rewinds the preceding textupdate apply", () => {
		const { editor, inline, blockId } =
			mountEditContextEditor("Hello world");
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext;
		expect(editContext).toBeDefined();

		emitTextUpdate(editContext!, {
			text: "nihao",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			selectionStart: 16,
			selectionEnd: 16,
		});
		emitTextFormatUpdate(editContext!);

		expect(
			authorityText(editor, blockId).includes("nihao"),
			"C1: textformatupdate rewound the composing apply",
		).toBe(false);
	});

	it("C1: compositionend with empty data drops the held apply", () => {
		const { editor, inline, blockId } =
			mountEditContextEditor("Hello world");
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext;
		expect(editContext).toBeDefined();

		emitTextUpdate(editContext!, {
			text: "nihao",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			selectionStart: 16,
			selectionEnd: 16,
		});
		emitTextFormatUpdate(editContext!);

		inline.dispatchEvent(
			new CompositionEvent("compositionend", {
				bubbles: true,
				data: "",
			}),
		);

		expect(
			authorityText(editor, blockId).includes("nihao"),
			"C1: cancelled compositionend does not commit",
		).toBe(false);
	});

	it("C1: compositionend with data commits the held apply", () => {
		const { editor, inline, blockId } =
			mountEditContextEditor("Hello world");
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext;
		expect(editContext).toBeDefined();

		emitTextUpdate(editContext!, {
			text: "nihao",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			selectionStart: 16,
			selectionEnd: 16,
		});
		emitTextFormatUpdate(editContext!);

		inline.dispatchEvent(
			new CompositionEvent("compositionend", {
				bubbles: true,
				data: "nihao",
			}),
		);

		expect(
			authorityText(editor, blockId).includes("Hello worldnihao"),
			"C1: committed compositionend applies the held text",
		).toBe(true);
	});

	it("C1: Escape leaves the discarded insert off the undo stack", () => {
		const { editor, inline, blockId } = mountEditContextEditor(
			"Hello world",
			{ withUndo: true },
		);
		editor.undoManager.stopCapturing();
		editor.apply(
			[{ type: "splice-text", blockId, from: 11, to: 11, insert: "!" }],
			{ origin: "user" },
		);
		editor.selectText(blockId, 12, 12);
		editor.undoManager.stopCapturing();
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext;
		expect(editContext).toBeDefined();

		emitTextUpdate(editContext!, {
			text: "nihao",
			updateRangeStart: 12,
			updateRangeEnd: 12,
			selectionStart: 17,
			selectionEnd: 17,
		});
		expect(authorityText(editor, blockId)).toBe("Hello world!nihao");
		emitTextFormatUpdate(editContext!);
		inline.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);

		expect(authorityText(editor, blockId)).toBe("Hello world!");
		expect(editor.undoManager.undo()).toBe(true);
		expect(
			authorityText(editor, blockId),
			"C1: first undo after Escape reverts the last real user edit, not a discarded IME insert",
		).toBe("Hello world");
		expect(editor.undoManager.undo()).toBe(true);
		expect(authorityText(editor, blockId)).toBe("");
		expect(editor.undoManager.canUndo()).toBe(false);
	});

	it("C1: speculative textupdate is a tracked user undo item before rewind", () => {
		const { editor, inline, blockId } = mountEditContextEditor(
			"Hello world",
			{ withUndo: true },
		);
		editor.undoManager.stopCapturing();
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext;
		expect(editContext).toBeDefined();

		emitTextUpdate(editContext!, {
			text: "nihao",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			selectionStart: 16,
			selectionEnd: 16,
		});

		expect(authorityText(editor, blockId)).toBe("Hello worldnihao");
		expect(editor.undoManager.undo()).toBe(true);
		expect(
			authorityText(editor, blockId),
			"C1: speculative apply uses origin user and is tracked",
		).toBe("Hello world");
	});

	it("C1: ordinary textupdate stays a user-undoable edit", () => {
		const { editor, inline, blockId } = mountEditContextEditor(
			"Hello world",
			{ withUndo: true },
		);
		editor.undoManager.stopCapturing();
		const editContext = (
			inline as HTMLElement & { editContext?: FakeEditContext }
		).editContext;
		expect(editContext).toBeDefined();

		emitTextUpdate(editContext!, {
			text: "!",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			selectionStart: 12,
			selectionEnd: 12,
		});

		expect(authorityText(editor, blockId)).toBe("Hello world!");
		expect(editor.undoManager.undo()).toBe(true);
		expect(
			authorityText(editor, blockId),
			"C1: ordinary textupdate remains origin-user so undo reverts it",
		).toBe("Hello world");
	});
});
