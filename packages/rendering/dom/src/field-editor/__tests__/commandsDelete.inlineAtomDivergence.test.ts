import { describe, expect, it } from "vitest";
import { createEditor, getCommandRegistry } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { applyDeleteBehavior } from "../commandsDelete";
import { DIRECT_HANDLERS } from "../contenteditableDirectHandlers";
import { handleFieldEditorKeyDown } from "../keyHandling";
import type { FieldEditorInputController } from "../controller";
import type { FieldEditorTextLike } from "../crdt";
import { stubFieldEditorParts } from "./fieldEditorParts.testHelpers";

/**
 * Owner-approved UX: Backspace next to an inline atom SELECTs on the first
 * press and deletes on the second. Live keydown / beforeinput go through
 * `registry.dispatch`. `applyDeleteBehavior` is the no-dispatch fallback
 * and already selected; both paths must stay on SELECT.
 *
 * Second press is ordinary delete-the-selection (`handleDelete` on a
 * non-collapsed range), not a second atom-specific step.
 */

function mentionDeltas() {
	return [
		{ insert: "hi" },
		{
			insert: {
				type: "mention",
				props: { id: "1", label: "Ada" },
			},
		},
		{ insert: "z" },
	];
}

function createMentionEditor() {
	const editor = createEditor({ schema: defaultSchema });
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "hiz" },
		{
			type: "splice-text",
			blockId,
			from: 2,
			to: 2,
			insert: {
				nodeType: "mention",
				props: { id: "1", label: "Ada" },
			},
		},
	]);
	return { editor, blockId };
}

function hasMention(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): boolean {
	return (editor.getBlock(blockId)?.inlineDeltas() ?? []).some((delta) => {
		const insert = delta.insert;
		return (
			typeof insert === "object" &&
			insert !== null &&
			"type" in insert &&
			insert.type === "mention"
		);
	});
}

function expectAtomSelected(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): void {
	expect(editor.selection?.type).toBe("text");
	if (editor.selection?.type !== "text") {
		throw new Error("expected text selection");
	}
	expect(editor.selection.anchor).toEqual({ blockId, offset: 2 });
	expect(editor.selection.focus).toEqual({ blockId, offset: 3 });
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

function createKeyEvent(key: string): KeyboardEvent {
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
	} as KeyboardEvent;
}

function createFieldEditor(blockId: string) {
	return {
		focusBlockId: blockId,
		inputMode: "richtext" as const,
		activeCellCoord: null,
		activateCell: () => {},
		activateTextSelection: () => {},
		deactivate: () => {},
		selectAllBehavior: "block-first" as const,
		...stubFieldEditorParts(),
	};
}

function spyDispatch(editor: ReturnType<typeof createEditor>): string[] {
	const registry = getCommandRegistry(editor);
	if (!registry) {
		throw new Error("expected command registry");
	}
	const dispatched: string[] = [];
	const originalDispatch = registry.dispatch.bind(registry);
	registry.dispatch = ((command, param, context) => {
		dispatched.push(command.name);
		return originalDispatch(command, param, context);
	}) as typeof registry.dispatch;
	return dispatched;
}

describe("inline atom delete select-then-delete", () => {
	describe("fallback applyDeleteBehavior (select)", () => {
		it("applyDeleteBehavior backward selects the adjacent atom and does not mutate", () => {
			const { editor, blockId } = createMentionEditor();

			const target = applyDeleteBehavior(editor, {
				blockId,
				ytext: getYText(editor, blockId),
				range: { start: 3, end: 3 },
				direction: "backward",
			});

			expect(target).toEqual({
				blockId,
				anchorOffset: 2,
				focusOffset: 3,
			});
			expect(editor.getBlock(blockId)?.inlineDeltas()).toEqual(
				mentionDeltas(),
			);
			editor.destroy();
		});

		it("applyDeleteBehavior forward selects the adjacent atom and does not mutate", () => {
			const { editor, blockId } = createMentionEditor();

			const target = applyDeleteBehavior(editor, {
				blockId,
				ytext: getYText(editor, blockId),
				range: { start: 2, end: 2 },
				direction: "forward",
			});

			expect(target).toEqual({
				blockId,
				anchorOffset: 2,
				focusOffset: 3,
			});
			expect(hasMention(editor, blockId)).toBe(true);
			editor.destroy();
		});
	});

	describe("live keydown / beforeinput (select then delete)", () => {
		it("handleFieldEditorKeyDown Backspace selects the adjacent atom on the first press", () => {
			const { editor, blockId } = createMentionEditor();
			const dispatched = spyDispatch(editor);

			const handled = handleFieldEditorKeyDown({
				event: createKeyEvent("Backspace"),
				editor,
				fieldEditor: createFieldEditor(blockId),
				ytext: getYText(editor, blockId),
				range: { start: 3, end: 3 },
			});

			expect(handled).toBe(true);
			expect(dispatched).toContain("pen.deleteBackward");
			expect(hasMention(editor, blockId)).toBe(true);
			expect(editor.getBlock(blockId)?.inlineDeltas()).toEqual(
				mentionDeltas(),
			);
			expectAtomSelected(editor, blockId);
			editor.destroy();
		});

		it("handleFieldEditorKeyDown Backspace deletes the selected atom on the second press", () => {
			const { editor, blockId } = createMentionEditor();
			const dispatched = spyDispatch(editor);
			const fieldEditor = createFieldEditor(blockId);
			const ytext = getYText(editor, blockId);

			handleFieldEditorKeyDown({
				event: createKeyEvent("Backspace"),
				editor,
				fieldEditor,
				ytext,
				range: { start: 3, end: 3 },
			});
			expect(hasMention(editor, blockId)).toBe(true);
			expectAtomSelected(editor, blockId);

			const handled = handleFieldEditorKeyDown({
				event: createKeyEvent("Backspace"),
				editor,
				fieldEditor,
				ytext,
				range: { start: 2, end: 3 },
			});

			expect(handled).toBe(true);
			expect(
				dispatched.filter((name) => name === "pen.deleteBackward"),
			).toHaveLength(2);
			expect(hasMention(editor, blockId)).toBe(false);
			expect(editor.getBlock(blockId)?.textContent()).toBe("hiz");
			editor.destroy();
		});

		it("DIRECT_HANDLERS.deleteContentBackward selects the adjacent atom on the first press", () => {
			const { editor, blockId } = createMentionEditor();
			const dispatched = spyDispatch(editor);
			const inputRange = { start: 3, end: 3 };

			DIRECT_HANDLERS.deleteContentBackward(
				{ inputType: "deleteContentBackward" } as InputEvent,
				editor,
				getYText(editor, blockId),
				createFieldEditor(
					blockId,
				) as unknown as FieldEditorInputController,
				{} as HTMLElement,
				{
					resolveCurrentInputRange: () => inputRange,
					applyListInputRule: () => false,
					applyInlineTextEdit: () => {
						throw new Error(
							"fallback applyInlineTextEdit must not run when registry dispatch succeeds",
						);
					},
				},
			);

			expect(dispatched).toContain("pen.deleteBackward");
			expect(hasMention(editor, blockId)).toBe(true);
			expectAtomSelected(editor, blockId);
			editor.destroy();
		});

		it("DIRECT_HANDLERS.deleteContentBackward deletes the selected atom on the second press", () => {
			const { editor, blockId } = createMentionEditor();
			const dispatched = spyDispatch(editor);
			let inputRange = { start: 3, end: 3 };
			const backend = {
				resolveCurrentInputRange: () => inputRange,
				applyListInputRule: () => false,
				applyInlineTextEdit: () => {
					throw new Error(
						"fallback applyInlineTextEdit must not run when registry dispatch succeeds",
					);
				},
			};
			const fieldEditor = createFieldEditor(
				blockId,
			) as unknown as FieldEditorInputController;
			const ytext = getYText(editor, blockId);

			DIRECT_HANDLERS.deleteContentBackward(
				{ inputType: "deleteContentBackward" } as InputEvent,
				editor,
				ytext,
				fieldEditor,
				{} as HTMLElement,
				backend,
			);
			expect(hasMention(editor, blockId)).toBe(true);
			expectAtomSelected(editor, blockId);

			inputRange = { start: 2, end: 3 };
			DIRECT_HANDLERS.deleteContentBackward(
				{ inputType: "deleteContentBackward" } as InputEvent,
				editor,
				ytext,
				fieldEditor,
				{} as HTMLElement,
				backend,
			);

			expect(
				dispatched.filter((name) => name === "pen.deleteBackward"),
			).toHaveLength(2);
			expect(hasMention(editor, blockId)).toBe(false);
			expect(editor.getBlock(blockId)?.textContent()).toBe("hiz");
			editor.destroy();
		});
	});

	it("fallback and live keystroke are the same product on the same fixture", () => {
		const selectSide = createMentionEditor();
		const liveSide = createMentionEditor();

		const selected = applyDeleteBehavior(selectSide.editor, {
			blockId: selectSide.blockId,
			ytext: getYText(selectSide.editor, selectSide.blockId),
			range: { start: 3, end: 3 },
			direction: "backward",
		});
		const handled = handleFieldEditorKeyDown({
			event: createKeyEvent("Backspace"),
			editor: liveSide.editor,
			fieldEditor: createFieldEditor(liveSide.blockId),
			ytext: getYText(liveSide.editor, liveSide.blockId),
			range: { start: 3, end: 3 },
		});

		expect(selected).toEqual({
			blockId: selectSide.blockId,
			anchorOffset: 2,
			focusOffset: 3,
		});
		expect(hasMention(selectSide.editor, selectSide.blockId)).toBe(true);
		expect(handled).toBe(true);
		expect(hasMention(liveSide.editor, liveSide.blockId)).toBe(true);
		expectAtomSelected(liveSide.editor, liveSide.blockId);
		selectSide.editor.destroy();
		liveSide.editor.destroy();
	});
});
