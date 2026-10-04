import {
	getEditorSelectionRecord,
	isCollapsed,
	isMultiBlock,
	usesInlineTextSelection,
} from "@input/pen-core";
import { generateId, type Editor, type Point } from "@input/pen-types";
import { measureWithRoot } from "../geometry/rootGeometry";
import { getEditorBlockSelectionRole } from "../utils/blockSelectionSemantics";
import { getPreorderBlockIds } from "../utils/documentPreorder";
import { getDocumentPlaceholderTargetBlockId } from "../utils/editorEmptyState";
import { getRootBlockEndpoints } from "../utils/parentIdTree";
import {
	isRepeatedCellSelection,
	resolveBlockPointerIntent,
	type PointerInteractionModel,
} from "../utils/editorInteractionModel";
import { resolvePointerDragSelection } from "../utils/pointerSelection";
import {
	activateCanonicalSelection,
	DRAG_THRESHOLD_PX,
	EDITOR_ROOT_SELECTOR,
	ensureEditorFocus,
	getBlockIdRange,
	getBoundaryPoint,
	resolveClickedBlockId,
	resolveClickedCellCoord,
	selectClickedBlock,
	shouldIgnorePointerGesture,
	type ContentGesturesContext,
} from "./contentGesturesShared";
import { pointToEditorSelectionPoint } from "./selectionBridge";

export function createPointerSelectionGestures<
	InteractionModel extends PointerInteractionModel,
>(ctx: ContentGesturesContext<InteractionModel>) {
	const {
		editor,
		fieldEditor,
		gestureEl,
		currentEditorRoot,
		getBlocksHost,
		pointerGestureRef,
		pointerGestureVersionRef,
		interactionModelRef,
		clearPointerSelectionState,
		blockSelectionEnabled,
	} = ctx;

	const handleClickOutsideBlocks = (event: MouseEvent): boolean => {
		const blocksHost = getBlocksHost();
		if (!blocksHost) return false;
		// The first and last top-level blocks come from model order, resolved
		// through the root: blocks may sit in AX1 list groups or containers, so
		// the host's DOM children are not the block list (FE5).
		const { firstBlockId, lastBlockId } = getRootBlockEndpoints(editor);

		if (!firstBlockId || !lastBlockId) {
			const newBlockId = generateId();
			editor.apply(
				[
					{
						type: "insert-block",
						blockId: newBlockId,
						blockType: "paragraph",
						props: {},
						position: "first",
					},
				],
				{ origin: "user" },
			);
			// No frame wait: the model selection lands now, and if the host
			// has not mounted the new block yet the projector parks the
			// record and the scheduler's P1 slot projects it once the
			// element exists (S4). A rAF here guessed at one frame.
			fieldEditor.activateTextSelection?.(newBlockId, 0, 0);
			return true;
		}

		const placeholderTargetBlockId =
			getDocumentPlaceholderTargetBlockId(editor);
		if (placeholderTargetBlockId) {
			fieldEditor.activateTextSelection?.(placeholderTargetBlockId, 0, 0);
			return true;
		}

		const measured = measureWithRoot(
			currentEditorRoot ?? gestureEl,
			({ reader }) => ({
				firstRect: reader.blockRect(firstBlockId),
				lastRect: reader.blockRect(lastBlockId),
			}),
		);
		if (!measured.firstRect || !measured.lastRect) return false;

		const clickedAbove = event.clientY < measured.firstRect.top;
		const clickedBelow = event.clientY > measured.lastRect.bottom;
		if (!clickedAbove && !clickedBelow) return false;

		const adjacentBlock = clickedAbove
			? editor.firstBlock()
			: editor.lastBlock();
		if (!adjacentBlock) return false;

		const schema = editor.schema.resolve(adjacentBlock.type);
		if (
			usesInlineTextSelection(schema) &&
			adjacentBlock.textContent().length === 0
		) {
			fieldEditor.activateTextSelection?.(adjacentBlock.id, 0, 0);
			return true;
		}

		const newBlockId = generateId();
		const position = clickedAbove
			? { before: adjacentBlock.id }
			: { after: adjacentBlock.id };
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: newBlockId,
					blockType: "paragraph",
					props: {},
					position,
				},
			],
			{ origin: "user" },
		);
		fieldEditor.activateTextSelection?.(newBlockId, 0, 0);
		return true;
	};

	let shiftClickAnchor: Point | null = null;

	const resolveShiftAnchor = (): Point | null => {
		const currentSelection = editor.selection;
		if (currentSelection?.type === "text") {
			return currentSelection.anchor;
		}
		if (
			currentSelection?.type === "block" &&
			currentSelection.blockIds.length > 0
		) {
			return getBoundaryPoint(ctx, currentSelection.blockIds[0], "start");
		}
		if (fieldEditor.focusBlockId) {
			return getBoundaryPoint(ctx, fieldEditor.focusBlockId, "start");
		}
		return null;
	};

	const handleClick = (event: MouseEvent) => {
		if (shouldIgnorePointerGesture(ctx, event)) {
			return;
		}
		const blockId = resolveClickedBlockId(ctx, event);
		if (!blockId) {
			if (handleClickOutsideBlocks(event)) {
				event.preventDefault();
			}
			return;
		}
		if (!event.shiftKey) return;

		const anchorPoint = shiftClickAnchor ?? resolveShiftAnchor();
		shiftClickAnchor = null;
		if (!anchorPoint || anchorPoint.blockId === blockId) return;

		const selectedIds = getBlockIdRange(ctx, anchorPoint.blockId, blockId);
		if (!selectedIds) return;
		const blockOrder = getPreorderBlockIds(editor);
		const selectingForward =
			blockOrder.indexOf(anchorPoint.blockId) <=
			blockOrder.indexOf(blockId);
		activateCanonicalSelection(
			ctx,
			anchorPoint,
			getBoundaryPoint(ctx, blockId, selectingForward ? "end" : "start"),
		);
		event.preventDefault();
	};

	const handleMouseDown = (event: MouseEvent): boolean => {
		if (event.shiftKey) {
			shiftClickAnchor = resolveShiftAnchor();
			return true;
		}
		shiftClickAnchor = null;
		return false;
	};

	const handleMouseUp = (event: MouseEvent) => {
		const gesture = pointerGestureRef.current;
		if (!gesture) return;
		const gestureVersion = pointerGestureVersionRef.current;
		clearPointerSelectionState();

		const clickCount = event.detail;
		const clientX = event.clientX;
		const clientY = event.clientY;
		const moved =
			Math.abs(clientX - gesture.clientX) > DRAG_THRESHOLD_PX ||
			Math.abs(clientY - gesture.clientY) > DRAG_THRESHOLD_PX;
		const root = gestureEl.closest(
			EDITOR_ROOT_SELECTOR,
		) as HTMLElement | null;

		const commitCanonicalSelection = (
			anchorPoint: Point,
			focusPoint: Point,
		) => {
			activateCanonicalSelection(ctx, anchorPoint, focusPoint);
			if (root) {
				ensureEditorFocus(ctx, root);
			}
			gesture.committed = true;
		};

		const isExpandedSingleBlockTextSelection = (
			selection: ReturnType<Editor["getSelection"]>,
		): boolean =>
			selection?.type === "text" &&
			!isCollapsed(selection) &&
			!isMultiBlock(selection) &&
			selection.anchor.blockId === selection.focus.blockId;

		const shouldPreferNativeInlineSelection = (
			anchorPoint: Point,
			focusPoint: Point,
		): boolean =>
			getEditorBlockSelectionRole(editor, anchorPoint.blockId) ===
				"editable-inline" &&
			getEditorBlockSelectionRole(editor, focusPoint.blockId) ===
				"editable-inline";

		const commitMappedTextSelection = (
			anchorPoint: Point,
			focusPoint: Point,
		): true => {
			if (anchorPoint.blockId !== focusPoint.blockId) {
				fieldEditor.applyDocumentTextSelection(
					anchorPoint,
					focusPoint,
					"pointer",
				);
				return true;
			}
			if (shouldPreferNativeInlineSelection(anchorPoint, focusPoint)) {
				fieldEditor.applyDomTextSelection(
					anchorPoint,
					focusPoint,
					"pointer",
				);
				return true;
			}
			commitCanonicalSelection(anchorPoint, focusPoint);
			return true;
		};

		// The reader accepted the gesture's native range at pointerup, inside
		// the pointer window (D19): a drag inside a field, or the word or
		// paragraph a multi-click expanded. Mouseup keeps it and writes only
		// what Pen computes, here the collapse of a range by a click.
		const tryHandleReaderSelection = (): boolean => {
			if (!root) {
				return false;
			}
			const startedWithExpandedTextSelection =
				gesture.startSelection?.type === "text" &&
				!isCollapsed(gesture.startSelection);
			const collapseToPointer = (): boolean => {
				const pointerPoint = pointToEditorSelectionPoint(
					root,
					clientX,
					clientY,
				);
				if (!pointerPoint) {
					return false;
				}
				fieldEditor.collapseSelectionToPoint(pointerPoint, "pointer");
				return true;
			};
			if (
				clickCount === 1 &&
				!moved &&
				startedWithExpandedTextSelection &&
				collapseToPointer()
			) {
				return true;
			}

			// A cell gesture is the cell handler's, and an authority the
			// reader did not write in this gesture is no native range to keep.
			if (resolveClickedCellCoord(ctx, event)) {
				return false;
			}
			const selection = editor.selection;
			if (selection?.type !== "text") {
				return false;
			}
			const expandedSingleBlock =
				isExpandedSingleBlockTextSelection(gesture.startSelection) ||
				isExpandedSingleBlockTextSelection(selection);
			if (
				(clickCount === 1 || clickCount >= 4) &&
				expandedSingleBlock &&
				!moved &&
				!isMultiBlock(selection) &&
				shouldPreferNativeInlineSelection(
					selection.anchor,
					selection.focus,
				) &&
				collapseToPointer()
			) {
				return true;
			}

			const readerWrote =
				(getEditorSelectionRecord(editor)?.version ?? 0) !==
				gesture.startSelectionVersion;
			if (!readerWrote && !moved) {
				return false;
			}
			if (
				!isCollapsed(selection) ||
				(startedWithExpandedTextSelection && clickCount < 3) ||
				moved
			) {
				return commitMappedTextSelection(
					selection.anchor,
					selection.focus,
				);
			}
			return false;
		};

		const tryHandleDraggedPointerSelection = (): boolean => {
			if (!root || !moved) {
				return false;
			}
			const resolvedSelection = resolvePointerDragSelection(
				editor,
				root,
				gesture,
				{
					clientX,
					clientY,
				},
			);
			if (!resolvedSelection) {
				return false;
			}
			if (resolvedSelection.mode === "block") {
				if (!blockSelectionEnabled) return false;
				editor.selectBlocks(resolvedSelection.blockIds, {
					origin: "pointer",
				});
				fieldEditor.deactivate();
				ensureEditorFocus(ctx, root);
				gesture.committed = true;
				return true;
			}
			if (resolvedSelection.mode === "mapped-text") {
				return commitMappedTextSelection(
					resolvedSelection.anchorPoint,
					resolvedSelection.focusPoint,
				);
			}
			commitCanonicalSelection(
				resolvedSelection.anchorPoint,
				resolvedSelection.focusPoint,
			);
			return true;
		};

		const tryHandleCellSelection = (blockId: string): boolean => {
			const cellCoord = resolveClickedCellCoord(ctx, event);
			if (!cellCoord) {
				return false;
			}
			if (clickCount >= 2) {
				fieldEditor.activateCell?.(
					blockId,
					cellCoord.row,
					cellCoord.col,
				);
				gesture.committed = true;
				return true;
			}
			if (
				isRepeatedCellSelection({
					startSelection: gesture.startSelection,
					selection: editor.selection,
					blockId,
					cellCoord,
				})
			) {
				if (!blockSelectionEnabled) {
					editor.selectCell(blockId, cellCoord.row, cellCoord.col, {
						origin: "pointer",
					});
					gesture.committed = true;
					return true;
				}
				editor.selectBlock(blockId, { origin: "pointer" });
				if (root) {
					ensureEditorFocus(ctx, root);
				}
				gesture.committed = true;
				return true;
			}
			editor.selectCell(blockId, cellCoord.row, cellCoord.col, {
				origin: "pointer",
			});
			gesture.committed = true;
			return true;
		};

		const tryHandleBlockSelection = (
			blockId: string,
			blockType: string,
		): boolean => {
			const schema = editor.schema.resolve(blockType);
			const blockPointerIntent = resolveBlockPointerIntent({
				blockId,
				clickCount,
				moved,
				schema,
				startSelection: gesture.startSelection,
				selection: editor.selection,
				interactionModel: interactionModelRef.current,
			});

			if (blockPointerIntent === "select-block-text") {
				commitCanonicalSelection(
					getBoundaryPoint(ctx, blockId, "start"),
					getBoundaryPoint(ctx, blockId, "end"),
				);
				return true;
			}
			if (blockPointerIntent === "enter-edit") {
				if (usesInlineTextSelection(schema)) {
					const pointerPoint = root
						? pointToEditorSelectionPoint(root, clientX, clientY)
						: null;
					if (pointerPoint) {
						activateCanonicalSelection(
							ctx,
							pointerPoint,
							pointerPoint,
						);
					} else {
						fieldEditor.activate(blockId);
					}
					gesture.committed = true;
					return true;
				}
				if (!blockSelectionEnabled) {
					return false;
				}
				selectClickedBlock(ctx, blockId);
				gesture.committed = true;
				return true;
			}
			if (blockPointerIntent === "select-block") {
				if (!blockSelectionEnabled) {
					return false;
				}
				selectClickedBlock(ctx, blockId);
				fieldEditor.deactivate();
				if (root) {
					ensureEditorFocus(ctx, root);
				}
				gesture.committed = true;
				return true;
			}
			if (!root) {
				fieldEditor.activate(blockId);
				gesture.committed = true;
				return true;
			}
			const pointerPoint = pointToEditorSelectionPoint(
				root,
				clientX,
				clientY,
			);
			if (!pointerPoint) {
				fieldEditor.activate(blockId);
				gesture.committed = true;
				return true;
			}
			activateCanonicalSelection(ctx, pointerPoint, pointerPoint);
			gesture.committed = true;
			return true;
		};

		const finalizePointerSelection = () => {
			if (gestureVersion !== pointerGestureVersionRef.current) {
				return;
			}
			if (gesture.promotedDuringDrag) {
				if (root) {
					ensureEditorFocus(ctx, root);
				}
				gesture.committed = true;
				return;
			}
			if (tryHandleDraggedPointerSelection()) {
				return;
			}
			if (tryHandleReaderSelection()) {
				return;
			}
			const clickedBlockId = resolveClickedBlockId(ctx, event);
			// A host-chrome origin is a drag anchor, not a clicked block.
			// A gesture that never reached one is still `handleClick`'s to
			// finish, and that is where the click-outside affordance lives.
			if (!clickedBlockId && gesture.startedInHostChrome) {
				return;
			}
			const blockId = clickedBlockId ?? gesture.blockId;
			const block = editor.getBlock(blockId);
			if (!block) return;
			if (tryHandleCellSelection(blockId)) {
				return;
			}
			tryHandleBlockSelection(blockId, block.type);
		};

		const completePointerSelection = () => {
			try {
				finalizePointerSelection();
			} finally {
				fieldEditor.notifyGestureEvent?.("pointerup");
			}
		};

		completePointerSelection();
	};

	return {
		handleClick,
		handleMouseDown,
		handleMouseUp,
	};
}
