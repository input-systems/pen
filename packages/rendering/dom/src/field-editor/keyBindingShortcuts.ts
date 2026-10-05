import { collectEditorKeyBindings, isCollapsed } from "@input/pen-core";
import type { Editor, KeyBindingContext } from "@input/pen-types";
import { matchesKey } from "./keymap";

export function tryHandleHistoryOverrideBinding(
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	if (!isUndoShortcut(event) && !isRedoShortcut(event)) {
		return false;
	}

	return runMatchingKeyBinding(editor, event);
}

/** Runs the first in-context binding for `event` that reports it handled it. */
export function runMatchingKeyBinding(
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	const bindings = collectEditorKeyBindings(editor);
	for (const binding of bindings) {
		if (
			matchesBindingContext(editor, binding.context) &&
			matchesKey(binding.key, event) &&
			binding.handler(editor, event)
		) {
			return true;
		}
	}

	return false;
}

function matchesBindingContext(
	editor: Editor,
	context: KeyBindingContext | undefined,
): boolean {
	if (!context) return true;

	const selection = editor.selection;
	const activeBlock = getActiveBlock(editor);

	if (
		context.blockType &&
		(!activeBlock || !context.blockType.includes(activeBlock.type))
	) {
		return false;
	}

	if (context.hasSelection !== undefined) {
		const hasSelection =
			selection?.type === "text"
				? !isCollapsed(selection)
				: selection !== null;
		if (hasSelection !== context.hasSelection) {
			return false;
		}
	}

	if (context.collapsed !== undefined) {
		const collapsed = selection?.type === "text" && isCollapsed(selection);
		if (collapsed !== context.collapsed) {
			return false;
		}
	}

	if (
		context.withinLayout &&
		(!activeBlock || !isWithinLayout(activeBlock, context.withinLayout))
	) {
		return false;
	}

	return true;
}

function getActiveBlock(editor: Editor) {
	const selection = editor.selection;
	if (!selection) return null;

	if (selection.type === "text") {
		return editor.getBlock(selection.anchor.blockId);
	}

	if (selection.type === "block") {
		const blockId = selection.blockIds[0];
		return blockId ? editor.getBlock(blockId) : null;
	}

	if (selection.type === "cell") {
		return editor.getBlock(selection.blockId);
	}

	return null;
}

function isWithinLayout(
	block: NonNullable<ReturnType<typeof getActiveBlock>>,
	allowedLayoutTypes: readonly string[],
): boolean {
	let parent = block.layoutParent();
	while (parent) {
		if (allowedLayoutTypes.includes(parent.type)) {
			return true;
		}
		parent = parent.layoutParent();
	}

	return false;
}

export function isSelectAllShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "a" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

export function isUndoShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "z" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

export function isRedoShortcut(event: KeyboardEvent): boolean {
	const key = event.key.toLowerCase();
	const usesMod = event.metaKey || event.ctrlKey;
	return (
		usesMod &&
		!event.altKey &&
		((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey))
	);
}
