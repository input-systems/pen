import type { Editor, Point } from "@input/pen-types";
import { getEditorBlockSelectionLength } from "../utils/blockSelectionSemantics";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { getPreorderBlockIds } from "../utils/documentPreorder";
import type { PointerInteractionModel } from "../utils/editorInteractionModel";
import type { PointerSelectionGesture } from "../utils/pointerSelection";
import type { RegionSelectionStore } from "../utils/regionSelection";
import { normalizeSelectionFormation } from "../utils/selectionFormation";
import type { FieldEditorSession } from "./controller";
import { getBlockBoundaryPoint } from "./selectionBridge";

export const EDITOR_ROOT_SELECTOR = "[data-pen-editor-root]";
export const IGNORE_POINTER_GESTURE_SELECTOR =
	"[data-pen-ignore-pointer-gesture]";
export const DRAG_THRESHOLD_PX = 3;

export interface ContentGestureRegionGesture {
	clientX: number;
	clientY: number;
	isSelecting: boolean;
}

/** A mutable slot. React's `useRef` result satisfies this structurally. */
export interface GestureSlot<T> {
	current: T;
}

export interface ContentGesturesContext<
	InteractionModel extends PointerInteractionModel = PointerInteractionModel,
> {
	editor: Editor;
	fieldEditor: FieldEditorSession;
	gestureEl: HTMLElement;
	currentEditorRoot: HTMLElement | null;
	getBlocksHost: () => HTMLElement | null;
	regionSelectionStore: RegionSelectionStore;
	regionGestureRef: GestureSlot<ContentGestureRegionGesture | null>;
	pointerGestureRef: GestureSlot<PointerSelectionGesture | null>;
	pointerGestureVersionRef: GestureSlot<number>;
	skipNextClickRef: GestureSlot<boolean>;
	interactionModelRef: GestureSlot<InteractionModel>;
	clearPointerSelectionState(): void;
	blockSelectionEnabled: boolean;
	runSync: (run: () => void) => void;
}

export function isWithinNestedEditorRoot(
	ctx: ContentGesturesContext,
	target: EventTarget | null,
): boolean {
	if (!(target instanceof Node)) {
		return false;
	}
	const element =
		target instanceof HTMLElement ? target : target.parentElement;
	const targetRoot = element?.closest(
		EDITOR_ROOT_SELECTOR,
	) as HTMLElement | null;
	return targetRoot != null && targetRoot !== ctx.currentEditorRoot;
}

export function resolveEventTargetElement(
	target: EventTarget | null,
): HTMLElement | null {
	if (target instanceof HTMLElement) {
		return target;
	}
	if (target instanceof Node) {
		return target.parentElement;
	}
	return null;
}

export function resolveClickedBlockId(
	ctx: ContentGesturesContext,
	event: MouseEvent,
): string | null {
	const target = resolveEventTargetElement(event.target);
	if (!target) return null;
	if (isWithinNestedEditorRoot(ctx, target)) return null;
	let blockEl: HTMLElement | null = target;
	while (blockEl && blockEl !== ctx.gestureEl) {
		if (blockEl.hasAttribute(DATA_ATTRS.editorBlock)) {
			break;
		}
		blockEl = blockEl.parentElement;
	}
	return blockEl?.getAttribute("data-block-id") ?? null;
}

export function resolveClickedCellCoord(
	ctx: ContentGesturesContext,
	event: MouseEvent,
): { row: number; col: number } | null {
	const target = resolveEventTargetElement(event.target);
	if (!target) return null;
	if (isWithinNestedEditorRoot(ctx, target)) return null;
	const cellEl = target.closest(
		`[${DATA_ATTRS.tableCell}]`,
	) as HTMLElement | null;
	if (!cellEl) return null;
	const rowAttr = cellEl.getAttribute(DATA_ATTRS.tableCellRow);
	const colAttr = cellEl.getAttribute(DATA_ATTRS.tableCellCol);
	if (rowAttr == null || colAttr == null) return null;
	const row = parseInt(rowAttr, 10);
	const col = parseInt(colAttr, 10);
	if (isNaN(row) || isNaN(col)) return null;
	return { row, col };
}

export function shouldIgnorePointerGesture(
	ctx: ContentGesturesContext,
	event: MouseEvent,
): boolean {
	const target = resolveEventTargetElement(event.target);
	if (!target) return false;
	if (isWithinNestedEditorRoot(ctx, target)) return true;
	return !!target.closest(IGNORE_POINTER_GESTURE_SELECTOR);
}

export function getBoundaryPoint(
	ctx: ContentGesturesContext,
	blockId: string,
	side: "start" | "end",
): Point {
	const root = ctx.gestureEl.closest(
		EDITOR_ROOT_SELECTOR,
	) as HTMLElement | null;
	return (
		(root ? getBlockBoundaryPoint(root, blockId, side) : null) ?? {
			blockId,
			offset:
				side === "start"
					? 0
					: getEditorBlockSelectionLength(ctx.editor, blockId),
		}
	);
}

export function getBlockIdRange(
	ctx: ContentGesturesContext,
	anchorBlockId: string,
	targetBlockId: string,
): string[] | null {
	const blockOrder = getPreorderBlockIds(ctx.editor);
	const anchorIdx = blockOrder.indexOf(anchorBlockId);
	const targetIdx = blockOrder.indexOf(targetBlockId);
	if (anchorIdx < 0 || targetIdx < 0) return null;
	return blockOrder.slice(
		Math.min(anchorIdx, targetIdx),
		Math.max(anchorIdx, targetIdx) + 1,
	);
}

export function ensureEditorFocus(
	ctx: ContentGesturesContext,
	root: HTMLElement,
) {
	const activeEl = root.ownerDocument?.activeElement;
	if (activeEl instanceof Node && root.contains(activeEl)) return;
	if (
		typeof ctx.fieldEditor.requestRootFocus === "function" &&
		!ctx.fieldEditor.requestRootFocus(root, "activate", {
			preventScroll: true,
		})
	) {
		return;
	}
	if (typeof ctx.fieldEditor.requestRootFocus !== "function") {
		root.focus({ preventScroll: true });
	}
}

export function activateCanonicalSelection(
	ctx: ContentGesturesContext,
	anchorPoint: Point,
	focusPoint: Point,
) {
	if (anchorPoint.blockId === focusPoint.blockId) {
		if (typeof ctx.fieldEditor.activateTextSelection === "function") {
			ctx.fieldEditor.activateTextSelection(
				anchorPoint.blockId,
				anchorPoint.offset,
				focusPoint.offset,
			);
		} else {
			ctx.editor.selectTextRange(anchorPoint, focusPoint);
			ctx.fieldEditor.activate(anchorPoint.blockId);
		}
		return;
	}

	const normalizedSelection = normalizeSelectionFormation(ctx.editor, {
		anchor: anchorPoint,
		focus: focusPoint,
	});
	if (normalizedSelection.type === "block") {
		if (!ctx.blockSelectionEnabled) return;
		ctx.gestureEl.ownerDocument?.getSelection()?.removeAllRanges();
		ctx.editor.selectBlocks(normalizedSelection.blockIds);
		ctx.fieldEditor.deactivate();
		return;
	}

	const selectedIds = getBlockIdRange(
		ctx,
		normalizedSelection.anchor.blockId,
		normalizedSelection.focus.blockId,
	);
	if (!selectedIds) return;
	ctx.fieldEditor.applyDocumentTextSelection(
		normalizedSelection.anchor,
		normalizedSelection.focus,
	);
}
