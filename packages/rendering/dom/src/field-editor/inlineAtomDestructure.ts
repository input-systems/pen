import { isCollapsed, isMultiBlock } from "@input/pen-core";
import type { Editor, SelectionOrigin } from "@input/pen-types";
import { getAttachedFieldEditor } from "../utils/fieldEditor";
import type { FieldEditorSession } from "./controller";
import {
	getInlineAtomAtOffset,
	replaceInlineAtomWithText,
	type InlineAtomDropTarget,
	type InlineAtomMoveRejectedEvent,
	type InlineAtomSnapshot,
	type ResolvedInlineAtomInteractions,
} from "./inlineAtomInteraction";
import type { InlineAtomWrapperInteractionOptions } from "./inlineAtomWrapperInteractions";

export function destructureInlineAtom(
	options: InlineAtomWrapperInteractionOptions,
	origin: SelectionOrigin = "programmatic",
): boolean {
	const atom = getInlineAtomAtOffset(options.editor, {
		blockId: options.blockId,
		offset: options.offset,
	});
	if (!atom) {
		notifyRejected(options, { reason: "stale-source" });
		return false;
	}

	const text = resolveDestructureText(options.interactions.destructure, atom);
	if (text == null) {
		return false;
	}

	const didReplace = replaceInlineAtomWithText({
		source: {
			editor: options.editor,
			blockId: options.blockId,
			offset: options.offset,
		},
		text,
		selection: "end",
		origin,
	});
	if (!didReplace) {
		return false;
	}

	options.interactions.onAfterDestructure?.({
		editor: options.editor,
		atom,
		blockId: options.blockId,
		startOffset: options.offset,
		endOffset: options.offset + text.length,
		text,
	});
	return true;
}

export function resolveShiftClickInlineAtomSelection(
	editor: Editor,
	blockId: string,
	atomOffset: number,
): { blockId: string; anchorOffset: number; focusOffset: number } {
	const atomStart = atomOffset;
	const atomEnd = atomOffset + 1;
	const selection = editor.selection;
	if (
		selection?.type !== "text" ||
		isMultiBlock(selection) ||
		selection.anchor.blockId !== blockId ||
		selection.focus.blockId !== blockId
	) {
		return {
			blockId,
			anchorOffset: atomStart,
			focusOffset: atomEnd,
		};
	}

	const selectionStart = Math.min(
		selection.anchor.offset,
		selection.focus.offset,
	);
	const selectionEnd = Math.max(
		selection.anchor.offset,
		selection.focus.offset,
	);
	if (!isCollapsed(selection)) {
		if (atomEnd <= selectionStart) {
			return {
				blockId,
				anchorOffset: selectionEnd,
				focusOffset: atomStart,
			};
		}
		if (atomStart >= selectionEnd) {
			return {
				blockId,
				anchorOffset: selectionStart,
				focusOffset: atomEnd,
			};
		}
		if (atomStart === selectionStart && atomEnd === selectionEnd) {
			return {
				blockId,
				anchorOffset: atomEnd,
				focusOffset: atomEnd,
			};
		}
		if (atomStart === selectionStart) {
			return {
				blockId,
				anchorOffset: selectionEnd,
				focusOffset: atomEnd,
			};
		}
		if (atomEnd === selectionEnd) {
			return {
				blockId,
				anchorOffset: selectionStart,
				focusOffset: atomStart,
			};
		}
		return {
			blockId,
			anchorOffset: selection.anchor.offset,
			focusOffset: selection.focus.offset,
		};
	}

	const anchorOffset = selection.anchor.offset;
	return {
		blockId,
		anchorOffset,
		focusOffset: anchorOffset <= atomStart ? atomEnd : atomStart,
	};
}

export function selectInlineAtomRangeFromShiftClick(
	options: InlineAtomWrapperInteractionOptions,
): boolean {
	const target = resolveShiftClickInlineAtomSelection(
		options.editor,
		options.blockId,
		options.offset,
	);
	const fieldEditor = getAttachedFieldEditor(
		options.editor,
	) as FieldEditorSession | null;
	if (fieldEditor?.activateTextSelection) {
		fieldEditor.activateTextSelection(
			target.blockId,
			target.anchorOffset,
			target.focusOffset,
			{ origin: "pointer" },
		);
		fieldEditor.focus();
		return true;
	}

	options.editor.selectText(
		target.blockId,
		target.anchorOffset,
		target.focusOffset,
		{ origin: "pointer" },
	);
	return true;
}

export function canDestructure(
	options: InlineAtomWrapperInteractionOptions,
): boolean {
	return options.interactions.destructure !== false;
}

function resolveDestructureText(
	destructure: ResolvedInlineAtomInteractions["destructure"],
	atom: InlineAtomSnapshot,
): string | null | undefined {
	if (typeof destructure === "function") {
		return destructure(atom);
	}
	if (destructure === true) {
		return atom.text;
	}
	if (destructure && typeof destructure === "object") {
		return destructure[atom.type]?.(atom);
	}
	return null;
}

export function notifyRejected(
	options: InlineAtomWrapperInteractionOptions,
	event: {
		target?: InlineAtomDropTarget;
		atom?: InlineAtomSnapshot;
		reason: InlineAtomMoveRejectedEvent["reason"];
	},
): void {
	options.interactions.onMoveRejected?.({
		source: {
			editor: options.editor,
			blockId: options.blockId,
			offset: options.offset,
		},
		...event,
	});
}
