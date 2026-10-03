import {
	buildTransitionSnapshot,
	clickSelectableBlock,
	convertPointerDrag,
	getEditorSelectionRecord,
	type TransitionSnapshot,
} from "@input/pen-core";
import type { Editor, Point, SelectionState } from "@input/pen-types";
import { pointToEditorSelectionPoint } from "../field-editor/selectionBridge";
import { getPreorderBlockIds } from "./documentPreorder";

export interface PointerSelectionGesture {
	blockId: string;
	clientX: number;
	clientY: number;
	anchorPoint: { blockId: string; offset: number } | null;
	startSelection: SelectionState | null;
	/** The authority record version at pointerdown; a later one means the reader accepted a range in this gesture. */
	startSelectionVersion: number;
	promotedDuringDrag: boolean;
	/**
	 * This gesture committed a selection (mouseup or a drag), so the
	 * `click` that follows it has nothing left to do.
	 */
	committed: boolean;
	/**
	 * `blockId` came from the nearest block edge (G4) rather than a block
	 * under the pointer (FE10). The gesture never entered a field, so it has
	 * no native range to inherit within one block, and a gesture that never
	 * reached a block leaves mouseup to the click-outside affordance.
	 */
	startedInHostChrome: boolean;
}

export type ResolvedPointerDragSelection =
	| {
			mode: "mapped-text" | "canonical";
			anchorPoint: { blockId: string; offset: number };
			focusPoint: { blockId: string; offset: number };
	  }
	| {
			mode: "block";
			blockIds: string[];
	  };

export function createPointerSelectionGesture(
	editor: Editor,
	input: {
		blockId: string;
		clientX: number;
		clientY: number;
		startedInHostChrome?: boolean;
	},
): PointerSelectionGesture {
	return {
		...input,
		startedInHostChrome: input.startedInHostChrome ?? false,
		anchorPoint: null,
		startSelection: editor.getSelection(),
		startSelectionVersion: getEditorSelectionRecord(editor)?.version ?? 0,
		promotedDuringDrag: false,
		committed: false,
	};
}

export function resolvePointerGestureAnchorPoint(
	gesture: PointerSelectionGesture,
	root: HTMLElement,
): { blockId: string; offset: number } | null {
	if (gesture.anchorPoint) {
		return gesture.anchorPoint;
	}

	if (gesture.startSelection?.type === "text") {
		return gesture.startSelection.anchor;
	}

	return pointToEditorSelectionPoint(root, gesture.clientX, gesture.clientY);
}

/** A pointer input with its points already resolved through G4. */
export type PointerSelectionInput =
	| { readonly kind: "drag"; readonly focus: Point }
	| { readonly kind: "click"; readonly blockId: string; readonly offset: number };

/**
 * The selection a pointer input forms: a drag through T2
 * (`convertPointerDrag`), a click through T5 (`clickSelectableBlock`). Pure:
 * the DOM work is resolving the points, which the caller has done.
 */
export function resolvePointerSelectionIntent(
	snapshot: TransitionSnapshot,
	gesture: { readonly anchor: Point | null },
	input: PointerSelectionInput,
): SelectionState {
	switch (input.kind) {
		case "drag": {
			const anchor = gesture.anchor ?? input.focus;
			const start = {
				type: "text" as const,
				anchor,
				focus: anchor,
				affinity: "downstream" as const,
				goalX: null,
			};
			return convertPointerDrag(snapshot, start, input.focus);
		}
		case "click":
			return clickSelectableBlock(snapshot, input.blockId, input.offset);
		default: {
			const _exhaustive: never = input;
			return _exhaustive;
		}
	}
}

export function resolvePointerDragSelection(
	editor: Editor,
	root: HTMLElement,
	gesture: PointerSelectionGesture,
	input: {
		clientX: number;
		clientY: number;
	},
): ResolvedPointerDragSelection | null {
	const focusPoint = pointToEditorSelectionPoint(
		root,
		input.clientX,
		input.clientY,
	);
	if (!focusPoint) {
		return null;
	}

	if (
		gesture.startSelection?.type === "block" &&
		gesture.startSelection.blockIds.includes(gesture.blockId) &&
		focusPoint.blockId !== gesture.blockId
	) {
		const blockIds = resolveBlockIdRange(
			getPreorderBlockIds(editor),
			gesture.blockId,
			focusPoint.blockId,
		);
		return blockIds ? { mode: "block", blockIds } : null;
	}

	const anchorPoint = resolvePointerGestureAnchorPoint(gesture, root);
	if (!anchorPoint) {
		return null;
	}
	// Within one block the browser owns the range and the reader accepted it
	// inside the pointer window. A drag anchored in host chrome never entered
	// a field, so there is no native range to inherit (FE10) and Pen has to
	// resolve that one itself.
	if (
		focusPoint.blockId === anchorPoint.blockId &&
		(!gesture.startedInHostChrome ||
			focusPoint.offset === anchorPoint.offset)
	) {
		return null;
	}

	const snapshot = buildTransitionSnapshot(editor, {
		blockIds: [anchorPoint.blockId, focusPoint.blockId],
	});
	const selection = resolvePointerSelectionIntent(
		snapshot,
		{ anchor: anchorPoint },
		{ kind: "drag", focus: focusPoint },
	);
	if (selection?.type !== "text") {
		return null;
	}
	const bothText =
		snapshot.blocks[anchorPoint.blockId]?.kind === "text" &&
		snapshot.blocks[focusPoint.blockId]?.kind === "text";
	return {
		mode: bothText ? "mapped-text" : "canonical",
		anchorPoint: selection.anchor,
		focusPoint: selection.focus,
	};
}

function resolveBlockIdRange(
	blockOrder: readonly string[],
	anchorBlockId: string,
	focusBlockId: string,
): string[] | null {
	const anchorIdx = blockOrder.indexOf(anchorBlockId);
	const focusIdx = blockOrder.indexOf(focusBlockId);
	if (anchorIdx < 0 || focusIdx < 0) {
		return null;
	}

	const from = Math.min(anchorIdx, focusIdx);
	const to = Math.max(anchorIdx, focusIdx);
	return blockOrder.slice(from, to + 1);
}
