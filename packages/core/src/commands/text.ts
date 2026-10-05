import type { FacetProvider } from "@input/pen-types";

import { commandHandler, defineCommand } from "./define";
import { handleConvertBlock } from "./textConvert";
import {
	deleteAdjacentInlineAtom,
	handleDelete,
	selectAdjacentInlineAtom,
} from "./textDelete";
import { handleListIndent, handleSplitBlock } from "./textEnter";
import {
	handleInsertLineBreak,
	handleInsertText,
	handleToggleMark,
} from "./textInsert";
import type {
	ConvertBlockParam,
	DeleteParam,
	InsertTextParam,
	ToggleMarkParam,
} from "./textParams";

export type {
	ConvertBlockParam,
	DeleteGranularity,
	DeleteParam,
	InsertTextParam,
	ToggleMarkParam,
} from "./textParams";

export const insertText = defineCommand<InsertTextParam>("pen.insertText");
export const deleteBackward = defineCommand<DeleteParam>("pen.deleteBackward");
export const deleteForward = defineCommand<DeleteParam>("pen.deleteForward");
export const insertLineBreak = defineCommand("pen.insertLineBreak");
export const splitBlock = defineCommand("pen.splitBlock");
export const indent = defineCommand("pen.indent");
export const outdent = defineCommand("pen.outdent");
export const toggleMark = defineCommand<ToggleMarkParam>("pen.toggleMark");
export const convertBlock =
	defineCommand<ConvertBlockParam>("pen.convertBlock");

export { deleteAdjacentInlineAtom, selectAdjacentInlineAtom };

export function textCommandHandlers(): FacetProvider[] {
	return [
		commandHandler(insertText, handleInsertText),
		commandHandler(deleteBackward, (editor, param) =>
			handleDelete(editor, "backward", param.granularity),
		),
		commandHandler(deleteForward, (editor, param) =>
			handleDelete(editor, "forward", param.granularity),
		),
		commandHandler(insertLineBreak, handleInsertLineBreak),
		commandHandler(splitBlock, handleSplitBlock),
		commandHandler(indent, (editor) => handleListIndent(editor, false)),
		commandHandler(outdent, (editor) => handleListIndent(editor, true)),
		commandHandler(toggleMark, handleToggleMark),
		commandHandler(convertBlock, handleConvertBlock),
	];
}
