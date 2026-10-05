import {
	deleteBackward,
	deleteForward,
	historyRedo,
	historyUndo,
	insertLineBreak,
	splitBlock,
	toggleMark,
} from "@input/pen-core";
import type { Command, Editor } from "@input/pen-types";
import { mapEditContextBeforeInput } from "./beforeinputMap";
import {
	applyBeforeInputPolicy,
	dispatchAndActivate,
	type FieldEditorCommandTarget,
} from "./commandDispatch";

type CommandParam = Readonly<Record<string, unknown>> | undefined;

/**
 * The policy table names commands as strings so it stays free of core imports;
 * this is where those names become dispatchable commands.
 *
 * The insert-text family is deliberately absent. Those rows read their payload
 * off the event (`data`, `dataTransfer`), so the row's static `param` does not
 * describe the edit: preventing them is still right, dispatching them with the
 * table's empty param is not.
 */
const COMMANDS_BY_NAME: Readonly<
	Record<string, Command<CommandParam> | undefined>
> = {
	"pen.deleteBackward": deleteBackward,
	"pen.deleteForward": deleteForward,
	"pen.splitBlock": splitBlock,
	"pen.insertLineBreak": insertLineBreak,
	"pen.toggleMark": toggleMark,
	"history.undo": historyUndo,
	"history.redo": historyRedo,
};

/**
 * B1 for the EditContext backend. Chromium routes most editing intents to the
 * attached EditContext as `textupdate`, but not all of them — line-granularity
 * deletes run as ordinary DOM edits against the editing host. Without this the
 * field is rewritten behind the document's back, and the divergence only shows
 * up on the next reconcile, when the stale model repaints over it.
 */
export function handleEditContextBeforeInput(options: {
	event: InputEvent;
	editor: Editor;
	fieldEditor: FieldEditorCommandTarget;
}): void {
	const { event, editor, fieldEditor } = options;
	const mapping = mapEditContextBeforeInput(event.inputType);

	if ("policy" in mapping) {
		applyBeforeInputPolicy(editor, event, mapping);
		return;
	}

	event.preventDefault();

	const command = COMMANDS_BY_NAME[mapping.commandName];
	if (!command) {
		return;
	}
	dispatchAndActivate(editor, fieldEditor, command, mapping.param);
}
