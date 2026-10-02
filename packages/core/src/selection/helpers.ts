import type {
	Affinity,
	DocumentRange,
	DocumentState,
	PenDocument,
	Point,
	ReadonlySelectionState,
	TextSelection,
} from "@input/pen-types";
import { documentPreorderBlockIdsFromDoc } from "../editor/documentPreorder";
import { DocumentRangeImpl } from "../editor/range";

type ReadonlyTextSelection = Extract<ReadonlySelectionState, { type: "text" }>;

/**
 * Live `TextSelection` constructor. Defaults `affinity` / `goalX`.
 * Predicates and the block span are helpers, not fields.
 */
export function createTextSelection(input: {
	readonly anchor: Point;
	readonly focus: Point;
	readonly affinity?: Affinity;
	readonly goalX?: number | null;
}): TextSelection {
	return {
		type: "text",
		anchor: { blockId: input.anchor.blockId, offset: input.anchor.offset },
		focus: { blockId: input.focus.blockId, offset: input.focus.offset },
		affinity: input.affinity ?? "downstream",
		goalX: input.goalX ?? null,
	};
}

export function isCollapsed(sel: ReadonlySelectionState): boolean {
	if (sel === null || sel.type !== "text") {
		return false;
	}
	return (
		sel.anchor.blockId === sel.focus.blockId &&
		sel.anchor.offset === sel.focus.offset
	);
}

export function isMultiBlock(sel: ReadonlySelectionState): boolean {
	if (sel === null || sel.type !== "text") {
		return false;
	}
	return sel.anchor.blockId !== sel.focus.blockId;
}

/**
 * Document-order block ids covered by `sel`. A live `PenDocument` walks
 * nested `children` as well as top-level `blockOrder`; a `DocumentState`
 * slices its cached preorder between the endpoints without walking (SCALE2).
 * Pass a plain id snapshot from a renderer effect — walking a live `Y.Array`
 * through a deep-proxied document writes back.
 */
export function getSelectionBlockRange(
	doc: PenDocument | DocumentState | readonly string[],
	sel: ReadonlySelectionState,
): string[] {
	if (sel === null) {
		return [];
	}
	switch (sel.type) {
		case "text":
			if (isBlockOrderList(doc)) {
				return blockIdsFromOrder(doc, sel.anchor.blockId, sel.focus.blockId);
			}
			return isDocumentState(doc)
				? blockIdsFromState(doc, sel.anchor.blockId, sel.focus.blockId)
				: blockIdsBetween(doc, sel.anchor.blockId, sel.focus.blockId);
		case "block":
			return [...sel.blockIds];
		case "cell":
			return [sel.blockId];
		case "app":
			return [];
		default: {
			const _exhaustive: never = sel;
			return _exhaustive;
		}
	}
}

export function isBlockSelected(
	blockOrder: readonly string[],
	sel: ReadonlySelectionState,
	blockId: string,
): boolean {
	return getSelectionBlockRange(blockOrder, sel).includes(blockId);
}

export function selectionToRange(
	doc: PenDocument,
	sel: ReadonlyTextSelection,
): DocumentRange {
	return new DocumentRangeImpl(sel.anchor, sel.focus, doc);
}

function isBlockOrderList(
	value: PenDocument | DocumentState | readonly string[],
): value is readonly string[] {
	return Array.isArray(value);
}

function isDocumentState(value: PenDocument | DocumentState): value is DocumentState {
	return typeof (value as Partial<DocumentState>).preorderIndexOf === "function";
}

function blockIdsFromState(
	state: DocumentState,
	anchorId: string,
	focusId: string,
): string[] {
	const order = state.preorderBlockIds();
	return sliceBlockIds(
		state.preorderIndexOf(anchorId),
		state.preorderIndexOf(focusId),
		anchorId,
		focusId,
		(index) => order[index] as string,
	);
}

function blockIdsFromOrder(
	order: readonly string[],
	anchorId: string,
	focusId: string,
): string[] {
	return sliceBlockIds(
		order.indexOf(anchorId),
		order.indexOf(focusId),
		anchorId,
		focusId,
		(index) => order[index] as string,
	);
}

function blockIdsBetween(
	doc: PenDocument,
	anchorId: string,
	focusId: string,
): string[] {
	return blockIdsFromOrder(
		documentPreorderBlockIdsFromDoc(doc),
		anchorId,
		focusId,
	);
}

function sliceBlockIds(
	anchorIndex: number,
	focusIndex: number,
	anchorId: string,
	focusId: string,
	idAt: (index: number) => string,
): string[] {
	if (anchorIndex < 0 && focusIndex < 0) {
		return [];
	}
	if (anchorIndex < 0) {
		return [focusId];
	}
	if (focusIndex < 0) {
		return [anchorId];
	}
	const from = Math.min(anchorIndex, focusIndex);
	const to = Math.max(anchorIndex, focusIndex);
	const ids: string[] = [];
	for (let i = from; i <= to; i++) {
		ids.push(idAt(i));
	}
	return ids;
}
