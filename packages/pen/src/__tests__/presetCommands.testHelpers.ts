import { createEditor, getCommandRegistry } from "@input/pen-core";
import type { Command, DocumentOp, Editor } from "@input/pen-types";
import { defaultPreset } from "../index";

/**
 * Helpers for dispatching core commands against the shipped schema. The
 * commands own block-level Enter and Backspace; the field editor only
 * dispatches them.
 */
export function createPresetEditor(): Editor {
	return createEditor({
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

/** Select `from..to` in `blockId`, then dispatch on the editor's registry. */
export function dispatchAt<P>(
	editor: Editor,
	command: Command<P>,
	param: P,
	blockId: string,
	from = 0,
	to = from,
): boolean {
	const registry = getCommandRegistry(editor);
	if (!registry) {
		throw new Error("createEditor did not install a command registry");
	}
	editor.selectText(blockId, from, to);
	return registry.dispatch(command, param);
}

export function convertFirstBlock(
	editor: Editor,
	type: string,
	text = "",
): string {
	const blockId = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [{ type: "set-props", blockId, props: { type } }];
	if (text) {
		ops.push({
			type: "splice-text",
			blockId,
			from: 0,
			to: 0,
			insert: text,
		});
	}
	editor.apply(ops);
	return blockId;
}

/** Insert a block of `blockType` after `afterBlockId`, optionally nested. */
export function insertBlockAfter(
	editor: Editor,
	afterBlockId: string,
	blockType: string,
	options: { text?: string; parentId?: string } = {},
): string {
	const blockId = crypto.randomUUID();
	const ops: DocumentOp[] = [
		{
			type: "insert-block",
			blockId,
			blockType,
			props: {},
			position: { after: afterBlockId },
		},
	];
	if (options.parentId) {
		ops.push({
			type: "set-props",
			blockId,
			props: { parentId: options.parentId },
		});
	}
	if (options.text) {
		ops.push({
			type: "splice-text",
			blockId,
			from: 0,
			to: 0,
			insert: options.text,
		});
	}
	editor.apply(ops);
	return blockId;
}

export function caretOf(
	editor: Editor,
): { blockId: string; offset: number } | null {
	const selection = editor.selection;
	return selection?.type === "text" ? selection.focus : null;
}
