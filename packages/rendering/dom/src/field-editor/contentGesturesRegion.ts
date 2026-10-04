import { measureWithRoot } from "../geometry/rootGeometry";
import { DATA_ATTRS } from "../utils/dataAttributes";
import type { PointerInteractionModel } from "../utils/editorInteractionModel";
import {
	createRegionSelectionRect,
	intersectRegionSelectionRect,
	pointWithinRect,
	regionRectIntersectsBlock,
	resolveRegionRect,
	type RegionSelectionRect,
	type RegionSelectorConfig,
} from "../utils/regionSelection";
import {
	EDITOR_ROOT_SELECTOR,
	ensureEditorFocus,
	resolveClickedBlockId,
	shouldIgnorePointerGesture,
	type ContentGesturesContext,
} from "./contentGesturesShared";

/** FE5: the blocks host's top-level blocks, including those inside an AX1 list group. */
const TOP_LEVEL_BLOCK_SELECTOR = `:scope > [${DATA_ATTRS.editorBlock}], :scope > [${DATA_ATTRS.listGroup}] > [${DATA_ATTRS.editorBlock}]`;

export function createRegionGestures<
	InteractionModel extends PointerInteractionModel,
>(ctx: ContentGesturesContext<InteractionModel>) {
	const {
		editor,
		fieldEditor,
		gestureEl,
		currentEditorRoot,
		getBlocksHost,
		regionSelectionStore,
		regionGestureRef,
		blockSelectionEnabled,
	} = ctx;

	const getRegionSelectorConfig = (
		event: MouseEvent,
	): RegionSelectorConfig | null => {
		if (!blockSelectionEnabled) return null;
		const config = regionSelectionStore.getSnapshot().config;
		if (!config?.enabled) return null;
		if (config.selectionMode !== "block") return null;
		if (config.activation !== "whenInactive") return null;
		if (event.shiftKey || event.button !== 0) return null;
		if (fieldEditor.isComposing) return null;
		if (fieldEditor.focusBlockId) return null;
		if (fieldEditor.isEditing) return null;
		const regionRect = resolveRegionRect(config);
		if (
			regionRect &&
			!pointWithinRect(event.clientX, event.clientY, regionRect)
		) {
			return null;
		}
		if (shouldIgnorePointerGesture(ctx, event)) return null;
		if (resolveClickedBlockId(ctx, event)) return null;
		return config;
	};

	const getIntersectedBlockIds = (rect: RegionSelectionRect): string[] => {
		const blocksHost = getBlocksHost();
		if (!blocksHost) return [];
		return measureWithRoot(currentEditorRoot ?? gestureEl, ({ reader }) => {
			const selectedIds: string[] = [];
			// Top-level blocks sit directly in the host or in an AX1 list group.
			for (const child of Array.from(
				blocksHost.querySelectorAll(TOP_LEVEL_BLOCK_SELECTOR),
			)) {
				const blockId = child.getAttribute(DATA_ATTRS.blockId);
				if (!blockId) continue;
				const blockRect = reader.blockRect(blockId);
				if (blockRect && regionRectIntersectsBlock(rect, blockRect)) {
					selectedIds.push(blockId);
				}
			}
			return selectedIds;
		});
	};

	const clearRegionSelectionState = () => {
		regionGestureRef.current = null;
		regionSelectionStore.clearLiveRect();
	};

	const handleMouseDown = (event: MouseEvent): boolean => {
		const regionSelectorConfig = getRegionSelectorConfig(event);
		if (regionSelectorConfig) {
			regionGestureRef.current = {
				clientX: event.clientX,
				clientY: event.clientY,
				isSelecting: false,
			};
			return true;
		}
		return false;
	};

	/** The region from the gesture's press to `event`, bounded, and the blocks it covers. */
	const resolveRegion = (
		gesture: { clientX: number; clientY: number },
		event: MouseEvent,
		config: Parameters<typeof resolveRegionRect>[0],
	) => {
		const boundedRect = intersectRegionSelectionRect(
			createRegionSelectionRect(
				gesture.clientX,
				gesture.clientY,
				event.clientX,
				event.clientY,
			),
			resolveRegionRect(config),
		);
		const selectedIds = boundedRect ? getIntersectedBlockIds(boundedRect) : [];
		return { boundedRect, selectedIds };
	};

	const handleMouseMove = (event: MouseEvent): boolean => {
		const gesture = regionGestureRef.current;
		if (!gesture) {
			return false;
		}
		const config = regionSelectionStore.getSnapshot().config;
		if (!blockSelectionEnabled || !config?.enabled) {
			clearRegionSelectionState();
			return true;
		}
		const moved =
			Math.abs(event.clientX - gesture.clientX) > config.threshold ||
			Math.abs(event.clientY - gesture.clientY) > config.threshold;
		if (!gesture.isSelecting && !moved) {
			return true;
		}
		gesture.isSelecting = true;
		event.preventDefault();
		const { boundedRect, selectedIds } = resolveRegion(gesture, event, config);
		regionSelectionStore.setLiveRect(boundedRect);
		if (selectedIds.length > 0) {
			editor.selectBlocks(selectedIds, { origin: "pointer" });
		} else {
			editor.setSelection(null, { origin: "pointer" });
		}
		fieldEditor.deactivate();
		return true;
	};

	const handleMouseUp = (event: MouseEvent): boolean => {
		const regionGesture = regionGestureRef.current;
		if (!regionGesture) {
			return false;
		}
		const wasSelecting = regionGesture.isSelecting;
		const regionRoot = gestureEl.closest(
			EDITOR_ROOT_SELECTOR,
		) as HTMLElement | null;
		if (wasSelecting) {
			if (!blockSelectionEnabled) {
				clearRegionSelectionState();
				return true;
			}
			const { selectedIds } = resolveRegion(
				regionGesture,
				event,
				regionSelectionStore.getSnapshot().config,
			);
			if (selectedIds.length > 0) {
				editor.selectBlocks(selectedIds, { origin: "pointer" });
				if (regionRoot) {
					ensureEditorFocus(ctx, regionRoot);
				}
			} else {
				editor.setSelection(null, { origin: "pointer" });
			}
		}
		clearRegionSelectionState();
		return wasSelecting;
	};

	return {
		handleMouseDown,
		handleMouseMove,
		handleMouseUp,
		clearRegionSelectionState,
	};
}
