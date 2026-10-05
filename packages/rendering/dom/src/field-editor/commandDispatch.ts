import {
	getCommandRegistry,
	isMultiBlock,
	type CommandDispatchContext,
} from "@input/pen-core";
import type {
	Command,
	Editor,
	FieldEditorFocusOptions,
	SelectionState,
} from "@input/pen-types";
import type {
	BeforeInputAllowPolicy,
	BeforeInputBlockPolicy,
} from "./beforeinputMap";

export interface FieldEditorCommandTarget {
	readonly focusBlockId?: string | null;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	commitProgrammaticTextSelection?(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: FieldEditorFocusOptions,
	): void;
	deactivate(): void;
	activateCell?(blockId: string, row: number, col: number): void;
}

export function dispatchEditorCommand<P>(
	editor: Editor,
	command: Command<P>,
	param: P,
	context?: CommandDispatchContext,
): boolean {
	const registry = getCommandRegistry(editor);
	if (!registry) {
		return false;
	}
	return registry.dispatch(command, param, {
		origin: "user",
		...context,
	});
}

export function syncEditorTextSelection(
	editor: Editor,
	blockId: string,
	range: { start: number; end: number } | null,
): void {
	if (!range) {
		return;
	}
	const selection = editor.selection;
	if (selection?.type === "text" && isMultiBlock(selection)) {
		return;
	}
	if (
		selection?.type === "text" &&
		selection.anchor.blockId === blockId &&
		selection.focus.blockId === blockId &&
		Math.min(selection.anchor.offset, selection.focus.offset) ===
			range.start &&
		Math.max(selection.anchor.offset, selection.focus.offset) === range.end
	) {
		return;
	}
	editor.selectText(blockId, range.start, range.end, { origin: "keyboard" });
}

export function activateFieldEditorFromSelection(
	editor: Editor,
	fieldEditor: FieldEditorCommandTarget,
): void {
	const selection = editor.selection;
	if (!selection) {
		return;
	}
	switch (selection.type) {
		case "text":
			// A multi-block text selection owns the `expanded` surface, which
			// `classifySelectionSurface` already assigned on selection change.
			// Activating one field or deactivating would both contradict it.
			if (isMultiBlock(selection)) {
				return;
			}
			if (
				fieldEditor.focusBlockId != null &&
				fieldEditor.focusBlockId !== selection.focus.blockId &&
				typeof fieldEditor.commitProgrammaticTextSelection ===
					"function"
			) {
				fieldEditor.commitProgrammaticTextSelection(
					selection.focus.blockId,
					selection.anchor.offset,
					selection.focus.offset,
					{ origin: "keyboard" },
				);
				return;
			}
			fieldEditor.activateTextSelection(
				selection.focus.blockId,
				selection.anchor.offset,
				selection.focus.offset,
				{ origin: "keyboard" },
			);
			return;
		case "block":
			fieldEditor.deactivate();
			return;
		case "cell":
			fieldEditor.activateCell?.(
				selection.blockId,
				selection.head.row,
				selection.head.col,
			);
			return;
		case "app":
			return;
		default: {
			const _exhaustive: never = selection;
			return _exhaustive;
		}
	}
}

export function dispatchAndActivate<P>(
	editor: Editor,
	fieldEditor: FieldEditorCommandTarget,
	command: Command<P>,
	param: P,
	context?: CommandDispatchContext,
): boolean {
	if (!dispatchEditorCommand(editor, command, param, context)) {
		return false;
	}
	activateFieldEditorFromSelection(editor, fieldEditor);
	return true;
}

export function keymapContextFromSelection(
	selection: SelectionState,
	activeCell: boolean,
): "text" | "cell" | "block" {
	if (activeCell) {
		return "cell";
	}
	if (!selection) {
		return "text";
	}
	switch (selection.type) {
		case "cell":
			return "cell";
		case "block":
			return "block";
		case "text":
		case "app":
			return "text";
		default: {
			const _exhaustive: never = selection;
			return _exhaustive;
		}
	}
}

/**
 * Applies a `beforeinput` policy row: `allow` leaves the event to the browser,
 * `block` cancels it and reports the unhandled input type.
 */
export function applyBeforeInputPolicy(
	editor: Editor,
	event: InputEvent,
	mapping: BeforeInputAllowPolicy | BeforeInputBlockPolicy,
): void {
	switch (mapping.policy) {
		case "allow":
			return;
		case "block":
			event.preventDefault();
			editor.internals.emit("diagnostic", {
				code: mapping.code,
				level: "warn",
				source: "beforeinput",
				message: `unhandled beforeinput inputType: ${event.inputType}`,
				inputType: event.inputType,
			});
			return;
		default: {
			const _exhaustive: never = mapping;
			return _exhaustive;
		}
	}
}
