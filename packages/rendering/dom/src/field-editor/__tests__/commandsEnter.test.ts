import { describe, expect, it } from "vitest";
import { createEditor, getCommandRegistry } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { applyEnterBehavior } from "../commandsEnter";
import { DIRECT_HANDLERS } from "../contenteditableDirectHandlers";
import { handleFieldEditorKeyDown } from "../keyHandling";
import type { FieldEditorInputController } from "../controller";
import type { FieldEditorTextLike } from "../crdt";
import { stubFieldEditorParts } from "./fieldEditorParts.testHelpers";

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

function createFieldEditor(blockId: string) {
	const activations: Array<{
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
		kind: "activate" | "commit";
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
					kind: "activate",
				});
			},
			commitProgrammaticTextSelection: (
				targetBlockId: string,
				anchorOffset: number,
				focusOffset: number,
			) => {
				activations.push({
					blockId: targetBlockId,
					anchorOffset,
					focusOffset,
					kind: "commit",
				});
			},
			deactivate: () => {},
			selectAllBehavior: "block-first" as const,
			...stubFieldEditorParts(),
		},
		activations,
	};
}

describe("applyEnterBehavior split authority", () => {
	it("lands authority on the new block after an enter split", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		// start off the split offset so onCommit mapping cannot hide a missing write
		editor.selectText(blockId, 0, 0);

		const ytext = getYText(editor, blockId);
		const target = applyEnterBehavior(editor, {
			blockId,
			inputMode: "richtext",
			ytext,
			range: { start: 5, end: 5 },
		});

		const newBlockId = editor.documentState.blockOrder[1];
		expect(target).toEqual({
			blockId: newBlockId,
			anchorOffset: 0,
			focusOffset: 0,
		});
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(editor.getBlock(newBlockId!)?.textContent()).toBe("");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: newBlockId, offset: 0 },
			focus: { blockId: newBlockId, offset: 0 },
		});
		editor.destroy();
	});

	it("beforeinput insertParagraph keeps authority on the new block", () => {
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

		const newBlockId = editor.documentState.blockOrder[1];
		expect(newBlockId).toEqual(expect.any(String));
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: newBlockId, offset: 0 },
			focus: { blockId: newBlockId, offset: 0 },
		});
		expect(fieldEditor.activations).toEqual([
			{
				blockId: newBlockId,
				anchorOffset: 0,
				focusOffset: 0,
				kind: "commit",
			},
		]);
		editor.destroy();
	});

	it("keydown Enter keeps authority on the new block", () => {
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

		const fieldEditor = createFieldEditor(blockId);
		const handled = handleFieldEditorKeyDown({
			event: {
				key: "Enter",
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,
				altKey: false,
				isComposing: false,
				defaultPrevented: false,
				preventDefault() {},
			} as KeyboardEvent,
			editor,
			fieldEditor: fieldEditor.controller,
			ytext: getYText(editor, blockId),
			range: { start: 5, end: 5 },
		});

		expect(handled).toBe(true);
		const newBlockId = editor.documentState.blockOrder[1];
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: newBlockId, offset: 0 },
			focus: { blockId: newBlockId, offset: 0 },
		});
		expect(fieldEditor.activations).toEqual([
			{
				blockId: newBlockId,
				anchorOffset: 0,
				focusOffset: 0,
				kind: "commit",
			},
		]);
		editor.destroy();
	});
});
