import {
	isCollapsed,
	isMultiBlock,
	usesInlineTextSelection,
} from "@input/pen-core";
import { generateId, type Editor, type Point } from "@input/pen-types";
import { getRootGeometry, measureWithRoot } from "../geometry/rootGeometry";
import { getEditorBlockSelectionRole } from "../utils/blockSelectionSemantics";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { getPreorderBlockIds } from "../utils/documentPreorder";
import { getDocumentPlaceholderTargetBlockId } from "../utils/editorEmptyState";
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
	shouldIgnorePointerGesture,
	type ContentGesturesContext,
} from "./contentGesturesShared";
import {
	domSelectionToEditor,
	pointToEditorSelectionPoint,
} from "./selectionBridge";

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
		skipNextClickRef,
		interactionModelRef,
		clearPointerSelectionState,
		blockSelectionEnabled,
	} = ctx;

	const handleClickOutsideBlocks = (event: MouseEvent): boolean => {
		const blocksHost = getBlocksHost();
		if (!blocksHost) return false;
		const firstBlockEl = blocksHost.querySelector(
			`[${DATA_ATTRS.editorBlock}]`,
		) as HTMLElement | null;
		const lastBlockEl = blocksHost.querySelector(
			`[${DATA_ATTRS.editorBlock}]:last-child`,
		) as HTMLElement | null;

		if (!firstBlockEl || !lastBlockEl) {
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

		const firstBlockId = firstBlockEl.getAttribute("data-block-id");
		const lastBlockId = lastBlockEl.getAttribute("data-block-id");
		const measured = measureWithRoot(
			currentEditorRoot ?? gestureEl,
			({ reader }) => ({
				firstRect: firstBlockId ? reader.blockRect(firstBlockId) : null,
				lastRect: lastBlockId ? reader.blockRect(lastBlockId) : null,
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
		if (skipNextClickRef.current) {
			skipNextClickRef.current = false;
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
			skipNextClickRef.current = true;
		};

		const isSelectionForward = (
			anchorPoint: Point,
			focusPoint: Point,
		): boolean => {
			const order = getPreorderBlockIds(editor);
			const anchorIdx = order.indexOf(anchorPoint.blockId);
			const focusIdx = order.indexOf(focusPoint.blockId);
			if (anchorIdx === focusIdx) {
				return anchorPoint.offset <= focusPoint.offset;
			}
			return anchorIdx <= focusIdx;
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
				fieldEditor.applyDocumentTextSelection(anchorPoint, focusPoint);
				return true;
			}
			if (shouldPreferNativeInlineSelection(anchorPoint, focusPoint)) {
				fieldEditor.applyDomTextSelection(anchorPoint, focusPoint);
				return true;
			}
			commitCanonicalSelection(anchorPoint, focusPoint);
			return true;
		};

		const tryHandleMappedDomSelection = (): boolean => {
			if (!root) {
				return false;
			}
			const startedWithExpandedTextSelection =
				gesture.startSelection?.type === "text" &&
				!isCollapsed(gesture.startSelection);
			if (
				clickCount === 1 &&
				!moved &&
				startedWithExpandedTextSelection
			) {
				const pointerPoint = pointToEditorSelectionPoint(
					root,
					clientX,
					clientY,
				);
				if (pointerPoint) {
					fieldEditor.collapseSelectionToPoint(pointerPoint);
					return true;
				}
			}

			const mappedSelection = domSelectionToEditor(root);
			if (!mappedSelection) {
				return false;
			}

			const hasExpandedSingleBlockTextSelectionAtMouseUp =
				isExpandedSingleBlockTextSelection(gesture.startSelection) ||
				isExpandedSingleBlockTextSelection(editor.selection) ||
				(mappedSelection.anchor.blockId ===
					mappedSelection.focus.blockId &&
					mappedSelection.anchor.offset !==
						mappedSelection.focus.offset);
			if (
				(clickCount === 1 || clickCount >= 4) &&
				hasExpandedSingleBlockTextSelectionAtMouseUp &&
				!moved &&
				mappedSelection.anchor.blockId ===
					mappedSelection.focus.blockId &&
				shouldPreferNativeInlineSelection(
					mappedSelection.anchor,
					mappedSelection.focus,
				)
			) {
				const pointerPoint = pointToEditorSelectionPoint(
					root,
					clientX,
					clientY,
				);
				if (pointerPoint) {
					fieldEditor.collapseSelectionToPoint(pointerPoint);
					return true;
				}
			}

			const collapsed =
				mappedSelection.anchor.blockId ===
					mappedSelection.focus.blockId &&
				mappedSelection.anchor.offset === mappedSelection.focus.offset;
			if (!collapsed) {
				const needsBoundarySnap =
					getEditorBlockSelectionRole(
						editor,
						mappedSelection.focus.blockId,
					) !== "editable-inline";
				if (needsBoundarySnap) {
					const selectingForward = isSelectionForward(
						mappedSelection.anchor,
						mappedSelection.focus,
					);
					const snappedPoint = pointToEditorSelectionPoint(
						root,
						clientX,
						clientY,
						{
							preferredBoundary: selectingForward
								? "end"
								: "start",
						},
					);
					commitCanonicalSelection(
						mappedSelection.anchor,
						snappedPoint ?? mappedSelection.focus,
					);
					return true;
				}
				return commitMappedTextSelection(
					mappedSelection.anchor,
					mappedSelection.focus,
				);
			}
			if (startedWithExpandedTextSelection && clickCount < 3) {
				return commitMappedTextSelection(
					mappedSelection.anchor,
					mappedSelection.focus,
				);
			}
			if (moved) {
				return commitMappedTextSelection(
					mappedSelection.anchor,
					mappedSelection.focus,
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
					getBoundaryPoint: (blockId, side) =>
						getBoundaryPoint(ctx, blockId, side),
				},
			);
			if (!resolvedSelection) {
				return false;
			}
			if (resolvedSelection.mode === "block") {
				if (!blockSelectionEnabled) return false;
				editor.selectBlocks(resolvedSelection.blockIds);
				fieldEditor.deactivate();
				ensureEditorFocus(ctx, root);
				skipNextClickRef.current = true;
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
				skipNextClickRef.current = true;
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
					editor.selectCell(blockId, cellCoord.row, cellCoord.col);
					skipNextClickRef.current = true;
					return true;
				}
				editor.selectBlock(blockId);
				if (root) {
					ensureEditorFocus(ctx, root);
				}
				skipNextClickRef.current = true;
				return true;
			}
			editor.selectCell(blockId, cellCoord.row, cellCoord.col);
			skipNextClickRef.current = true;
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
					skipNextClickRef.current = true;
					return true;
				}
				if (!blockSelectionEnabled) {
					return false;
				}
				editor.selectBlock(blockId);
				skipNextClickRef.current = true;
				return true;
			}
			if (blockPointerIntent === "select-block") {
				if (!blockSelectionEnabled) {
					return false;
				}
				editor.selectBlock(blockId);
				fieldEditor.deactivate();
				if (root) {
					ensureEditorFocus(ctx, root);
				}
				skipNextClickRef.current = true;
				return true;
			}
			if (!root) {
				fieldEditor.activate(blockId);
				skipNextClickRef.current = true;
				return true;
			}
			const pointerPoint = pointToEditorSelectionPoint(
				root,
				clientX,
				clientY,
			);
			if (!pointerPoint) {
				fieldEditor.activate(blockId);
				skipNextClickRef.current = true;
				return true;
			}
			activateCanonicalSelection(ctx, pointerPoint, pointerPoint);
			skipNextClickRef.current = true;
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
				skipNextClickRef.current = true;
				return;
			}
			if (tryHandleDraggedPointerSelection()) {
				return;
			}
			if (tryHandleMappedDomSelection()) {
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

		if (clickCount > 1 && root) {
			// A multi-click finishes by reading the browser's own word or
			// paragraph expansion, so the read waits a frame for the engine
			// to settle. Same frame as before, owned by the scheduler and
			// running in its read phase (FE3) rather than a bare rAF.
			void getRootGeometry(root).scheduler.read(completePointerSelection);
			return;
		}
		completePointerSelection();
	};

	return {
		handleClick,
		handleMouseDown,
		handleMouseUp,
	};
}
