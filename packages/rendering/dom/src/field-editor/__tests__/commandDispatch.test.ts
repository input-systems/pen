import { describe, expect, it } from "vitest";
import { createEditor, getCommandRegistry, splitBlock } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { handleFieldEditorKeyDown } from "../keyHandling";
import { DIRECT_HANDLERS } from "../contenteditableDirectHandlers";
import type { FieldEditorInputController } from "../controller";
import type { FieldEditorTextLike } from "../crdt";
import { stubFieldEditorParts } from "./fieldEditorParts.testHelpers";

function createKeyEvent(
	key: string,
	options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
	let defaultPrevented = false;
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		isComposing: false,
		defaultPrevented,
		preventDefault() {
			defaultPrevented = true;
			Object.defineProperty(this, "defaultPrevented", {
				configurable: true,
				value: true,
			});
		},
		...options,
	} as KeyboardEvent;
}

function getYText(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): FieldEditorTextLike {
	const adapter = editor.internals.adapter;
	const doc = editor.internals.crdtDoc;
	const ydoc = adapter.raw<{
		getMap(name: string): {
			get(key: string): { get(field: string): unknown } | undefined;
		};
	}>(doc);
	const ytext = ydoc
		.getMap("blocks")
		.get(blockId)
		?.get("content") as FieldEditorTextLike | null;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

function spyRegistryDispatch(
	registry: NonNullable<ReturnType<typeof getCommandRegistry>>,
): string[] {
	const dispatched: string[] = [];
	const originalDispatch = registry.dispatch.bind(registry);
	registry.dispatch = ((command, param, context) => {
		dispatched.push(command.name);
		return originalDispatch(command, param, context);
	}) as typeof registry.dispatch;
	return dispatched;
}

function createFieldEditor(blockId: string) {
	const activations: Array<{
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	}> = [];
	return {
		controller: {
			focusBlockId: blockId,
			inputMode: "richtext" as const,
			activeCellCoord: null,
			activateCell: () => {},
			activateTextSelection: (
				targetBlockId: string,
				anchorOffset: number,
				focusOffset: number,
			) => {
				activations.push({
					blockId: targetBlockId,
					anchorOffset,
					focusOffset,
				});
			},
			commitProgrammaticTextSelection: (
				_targetBlockId: string,
				_anchorOffset: number,
				_focusOffset: number,
			) => {},
			deactivate: () => {},
			selectAllBehavior: "block-first" as const,
			...stubFieldEditorParts(),
		},
		activations,
	};
}

describe("field-editor command registry dispatch", () => {
	it("Enter splits through the core registry rather than a local handler", () => {
		const editor = createEditor({ schema: defaultSchema });
		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}

		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 2, 2);

		const dispatched = spyRegistryDispatch(registry);

		const fieldEditor = createFieldEditor(blockId);
		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Enter"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 2, end: 2 },
		});

		expect(handled).toBe(true);
		expect(dispatched).toContain(splitBlock.name);
		expect(editor.documentState.blockOrder).toHaveLength(2);
		expect(editor.getBlock(blockId)?.textContent()).toBe("He");
		editor.destroy();
	});

	it("Backspace deletes a grapheme through the core registry", () => {
		const editor = createEditor({ schema: defaultSchema });
		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hi👋" },
		]);

		const dispatched = spyRegistryDispatch(registry);

		const fieldEditor = createFieldEditor(blockId);
		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Backspace"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: "Hi👋".length, end: "Hi👋".length },
		});

		expect(handled).toBe(true);
		expect(dispatched).toContain("pen.deleteBackward");
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hi");
		editor.destroy();
	});

	it("beforeinput insertParagraph dispatches pen.splitBlock", () => {
		const editor = createEditor({ schema: defaultSchema });
		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		const dispatched = spyRegistryDispatch(registry);

		const fieldEditor = createFieldEditor(blockId);
		DIRECT_HANDLERS.insertParagraph(
			{ inputType: "insertParagraph" } as InputEvent,
			editor,
			getYText(editor, blockId),
			fieldEditor.controller as unknown as FieldEditorInputController,
			{} as HTMLElement,
			{
				resolveCurrentInputRange: () => ({ start: 5, end: 5 }),
				applyListInputRule: () => false,
				applyInlineTextEdit: () => {},
			},
		);

		expect(dispatched).toContain("pen.splitBlock");
		expect(editor.documentState.blockOrder).toHaveLength(2);
		editor.destroy();
	});

	it("Tab indents a nestable list item through pen.indent", () => {
		const editor = createEditor({ schema: defaultSchema });
		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "set-props",
				blockId: firstBlockId,
				props: { type: "bulletListItem" },
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "bulletListItem",
				props: { indent: 0 },
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: "child",
			},
		]);

		const dispatched = spyRegistryDispatch(registry);

		const fieldEditor = createFieldEditor(secondBlockId);
		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Tab"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, secondBlockId),
			range: { start: 2, end: 2 },
		});

		expect(handled).toBe(true);
		expect(dispatched).toContain("pen.indent");
		expect(editor.getBlock(secondBlockId)?.props.indent).toBe(1);
		expect(fieldEditor.activations).toEqual([
			{ blockId: secondBlockId, anchorOffset: 2, focusOffset: 2 },
		]);
		editor.destroy();
	});

	it("ArrowDown at a block edge dispatches pen.caretDown through the keymap", () => {
		const editor = createEditor({ schema: defaultSchema });
		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "Hi",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);
		editor.selectText(firstBlockId, 2, 2);

		const dispatched = spyRegistryDispatch(registry);
		const fieldEditor = createFieldEditor(firstBlockId);
		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("ArrowDown"),
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, firstBlockId),
			range: { start: 2, end: 2 },
		});

		expect(handled).toBe(true);
		expect(dispatched).toContain("pen.caretDown");
		expect(editor.selection?.type).toBe("text");
		if (editor.selection?.type !== "text") {
			throw new Error("expected text selection");
		}
		expect(editor.selection.anchor).toEqual({
			blockId: secondBlockId,
			offset: 0,
		});
		expect(editor.selection.focus).toEqual({
			blockId: secondBlockId,
			offset: 0,
		});
		editor.destroy();
	});

	it("inserts at the live range when activateTextSelection cleared the programmatic caret", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "First" },
		]);
		editor.selectText(blockId, 0, 0);

		const fieldEditor = createFieldEditor(blockId);
		fieldEditor.controller.activateTextSelection(blockId, 0, 0);
		DIRECT_HANDLERS.insertText(
			{
				inputType: "insertText",
				data: "!",
			} as InputEvent,
			editor,
			getYText(editor, blockId),
			fieldEditor.controller as unknown as FieldEditorInputController,
			{} as HTMLElement,
			{
				resolveCurrentInputRange: () => ({ start: 5, end: 5 }),
				applyListInputRule: () => false,
				applyInlineTextEdit: () => {},
			},
		);

		expect(editor.getBlock(blockId)?.textContent()).toBe("First!");
		editor.destroy();
	});

	it("inserts at the resolved live range when editor.selectText is stale", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello world",
			},
		]);
		editor.selectText(blockId, 3, 3);

		const fieldEditor = createFieldEditor(blockId);
		DIRECT_HANDLERS.insertText(
			{
				inputType: "insertText",
				data: "!",
			} as InputEvent,
			editor,
			getYText(editor, blockId),
			fieldEditor.controller as unknown as FieldEditorInputController,
			{} as HTMLElement,
			{
				resolveCurrentInputRange: () => ({ start: 11, end: 11 }),
				applyListInputRule: () => false,
				applyInlineTextEdit: () => {},
			},
		);

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world!");
		editor.destroy();
	});

	it("inserts at the live caret after same-turn P1, without a programmatic range resolver", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello world",
			},
		]);
		editor.selectText(blockId, 3, 3);

		const fieldEditor = createFieldEditor(blockId);
		fieldEditor.controller.commitProgrammaticTextSelection(blockId, 3, 3);
		DIRECT_HANDLERS.insertText(
			{
				inputType: "insertText",
				data: "!",
			} as InputEvent,
			editor,
			getYText(editor, blockId),
			fieldEditor.controller as unknown as FieldEditorInputController,
			{} as HTMLElement,
			{
				// live range after same-turn P1. a stale {11,11} lands at the end.
				resolveCurrentInputRange: () => ({ start: 3, end: 3 }),
				applyListInputRule: () => false,
				applyInlineTextEdit: () => {},
			},
		);

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hel!lo world");
		editor.destroy();
	});
});
