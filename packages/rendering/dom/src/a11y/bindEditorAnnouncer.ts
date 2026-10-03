import {
	announceEditorA11y,
	announcerFacet,
	isCollapsed,
	resolveA11yBlockTypeLabel,
	resolveSchemaA11y,
} from "@input/pen-core";
import {
	ANNOUNCER_SLOT_KEY,
	type CommitEvent,
	type Editor,
	type HistoryAppliedEvent,
	type SelectionState,
	type Unsubscribe,
} from "@input/pen-types";

import { createAnnouncer } from "./announcer";
import { getRootGeometry } from "../geometry/rootGeometry";
import { getInlineAtomAtOffset } from "../field-editor/inlineAtomModel";

export function bindEditorAnnouncer(
	editor: Editor,
	root: HTMLElement,
): Unsubscribe {
	// AX2: each announcement is one write in the root's scheduler write phase.
	const announcer = createAnnouncer({
		root,
		schedule: (write) => void getRootGeometry(root).scheduler.write(write),
	});
	editor.internals.assignSlot(ANNOUNCER_SLOT_KEY, announcer);

	let previousSelection = editor.selection;
	const unsubscribes: Unsubscribe[] = [
		editor.on("commit", (event) => {
			announceCommit(editor, event);
		}),
		editor.on("historyApplied", (event) => {
			announceHistory(editor, event);
		}),
		editor.on("selectionChange", () => {
			const selection = editor.selection;
			announceSelectionChange(editor, previousSelection, selection);
			previousSelection = selection;
		}),
	];

	return () => {
		for (const unsubscribe of unsubscribes) {
			unsubscribe();
		}
		if (editor.facet(announcerFacet) === announcer) {
			editor.internals.assignSlot(ANNOUNCER_SLOT_KEY, undefined);
		}
		announcer.dispose();
	};
}

function announceCommit(editor: Editor, event: CommitEvent): void {
	if (event.source === "undo" || event.source === "redo") {
		return;
	}
	for (const change of event.summary.structural) {
		if (
			change.type === "block-props-changed" &&
			change.keys.includes("type")
		) {
			const nextType = editor.getBlock(change.blockId)?.type ?? "";
			announceEditorA11y(editor, "blockConverted", {
				blockType: resolveA11yBlockTypeLabel(editor, nextType),
			});
		}
	}
}

function announceHistory(editor: Editor, event: HistoryAppliedEvent): void {
	const hint = resolveHistoryHint(editor, event.selection);
	if (hint.length === 0) {
		return;
	}
	if (event.kind === "undo") {
		announceEditorA11y(editor, "undoApplied", { hint });
		return;
	}
	announceEditorA11y(editor, "redoApplied", { hint });
}

function resolveHistoryHint(editor: Editor, selection: SelectionState): string {
	const blockId = resolveHintBlockId(editor, selection);
	const type = blockId ? editor.getBlock(blockId)?.type : undefined;
	return type ? resolveA11yBlockTypeLabel(editor, type) : "";
}

function resolveHintBlockId(
	editor: Editor,
	selection: SelectionState,
): string | undefined {
	if (selection?.type === "text") {
		return selection.focus.blockId;
	}
	if (selection?.type === "block") {
		return selection.blockIds[0];
	}
	if (selection?.type === "cell") {
		return selection.blockId;
	}
	if (selection?.type === "app") {
		return undefined;
	}
	return editor.firstBlock()?.id;
}

function announceSelectionChange(
	editor: Editor,
	previous: SelectionState,
	next: SelectionState,
): void {
	if (next?.type === "block") {
		if (next.blockIds.length === 0) {
			return;
		}
		const count = next.blockIds.length;
		const wasBlock =
			previous?.type === "block" && previous.blockIds.length > 0;
		if (!wasBlock) {
			announceEditorA11y(editor, "blockSelectionEntered", { count });
			return;
		}
		if (!sameBlockIds(previous.blockIds, next.blockIds)) {
			announceEditorA11y(editor, "blockSelectionChanged", { count });
		}
		return;
	}
	if (next?.type === "cell") {
		const rows = Math.abs(next.head.row - next.anchor.row) + 1;
		const columns = Math.abs(next.head.col - next.anchor.col) + 1;
		if (
			previous?.type !== "cell" ||
			previous.blockId !== next.blockId ||
			previous.anchor.row !== next.anchor.row ||
			previous.anchor.col !== next.anchor.col ||
			previous.head.row !== next.head.row ||
			previous.head.col !== next.head.col
		) {
			announceEditorA11y(editor, "cellSelectionChanged", {
				rows,
				columns,
			});
		}
		return;
	}
	if (next?.type === "text") {
		announceAtomSelection(editor, previous, next);
		return;
	}
	if (next?.type === "app" || next == null) {
		return;
	}
	const _exhaustive: never = next;
	void _exhaustive;
}

function announceAtomSelection(
	editor: Editor,
	previous: SelectionState,
	next: Extract<SelectionState, { type: "text" }>,
): void {
	if (!isCollapsed(next)) {
		return;
	}
	const atom = getInlineAtomAtOffset(editor, next.focus);
	if (!atom) {
		return;
	}
	const previousAtom =
		previous?.type === "text" && isCollapsed(previous)
			? getInlineAtomAtOffset(editor, previous.focus)
			: null;
	if (
		previousAtom &&
		previousAtom.blockId === atom.blockId &&
		previousAtom.offset === atom.offset &&
		previousAtom.type === atom.type
	) {
		return;
	}
	announceEditorA11y(editor, "atomSelected", {
		atomType: resolveSchemaA11y(editor, {
			kind: "inline",
			type: atom.type,
			props: atom.props,
		}).label,
	});
}

function sameBlockIds(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}
