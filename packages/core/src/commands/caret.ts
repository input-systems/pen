import type { FacetProvider } from "@input/pen-types";

import { commandHandler } from "./define";
import {
	caretBlockEnd,
	caretBlockStart,
	caretDocEnd,
	caretDocStart,
	caretDown,
	caretLeft,
	caretLineEnd,
	caretLineStart,
	caretRight,
	caretUp,
	caretWordLeft,
	caretWordRight,
	selectAll,
	selectBlock,
} from "./caretCommands";
import {
	handleDocEdge,
	handleGraphemeCaret,
	handleLineOrBlockEdge,
	handleSelectAll,
	handleSelectBlock,
	handleWordCaret,
} from "./caretMotion";
import { handleVerticalCaret } from "./caretVerticalMotion";

export type { CaretMotionParam, SelectBlockParam } from "./caretParams";
export {
	caretBlockEnd,
	caretBlockStart,
	caretDocEnd,
	caretDocStart,
	caretDown,
	caretLeft,
	caretLineEnd,
	caretLineStart,
	caretRight,
	caretUp,
	caretWordLeft,
	caretWordRight,
	selectAll,
	selectBlock,
} from "./caretCommands";
export { setLineEdgeMeasure } from "./caretMotion";

export function caretCommandHandlers(): FacetProvider[] {
	return [
		commandHandler(caretLeft, (editor, param) =>
			handleGraphemeCaret(editor, param, -1),
		),
		commandHandler(caretRight, (editor, param) =>
			handleGraphemeCaret(editor, param, 1),
		),
		commandHandler(caretUp, (editor, param) =>
			handleVerticalCaret(editor, param, "up"),
		),
		commandHandler(caretDown, (editor, param) =>
			handleVerticalCaret(editor, param, "down"),
		),
		commandHandler(caretLineStart, (editor, param) =>
			handleLineOrBlockEdge(editor, param, "start", true),
		),
		commandHandler(caretLineEnd, (editor, param) =>
			handleLineOrBlockEdge(editor, param, "end", true),
		),
		commandHandler(caretBlockStart, (editor, param) =>
			handleLineOrBlockEdge(editor, param, "start", false),
		),
		commandHandler(caretBlockEnd, (editor, param) =>
			handleLineOrBlockEdge(editor, param, "end", false),
		),
		commandHandler(caretDocStart, (editor, param) =>
			handleDocEdge(editor, param, "start"),
		),
		commandHandler(caretDocEnd, (editor, param) =>
			handleDocEdge(editor, param, "end"),
		),
		commandHandler(caretWordLeft, (editor, param) =>
			handleWordCaret(editor, param, -1),
		),
		commandHandler(caretWordRight, (editor, param) =>
			handleWordCaret(editor, param, 1),
		),
		commandHandler(selectAll, handleSelectAll),
		commandHandler(selectBlock, handleSelectBlock),
	];
}
