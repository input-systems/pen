/**
 * Pointer gestures over editor content: click, shift-click, drag-select,
 * region (marquee) select, cell select, and the click-outside-blocks
 * affordances.
 *
 * Framework-free. A binding attaches this to its content element and
 * hands it mutable slots for the gesture bookkeeping that must survive
 * across events. React passes `flushSync` as `runSync`; bindings without
 * a batching renderer pass nothing and the call runs inline.
 */
import type { Editor } from "@input/pen-types";
import type { PointerInteractionModel } from "../utils/editorInteractionModel";
import type { PointerSelectionGesture } from "../utils/pointerSelection";
import type { RegionSelectionStore } from "../utils/regionSelection";
import type { FieldEditorSession } from "./controller";
import { createDragGestures } from "./contentGesturesDrag";
import { createPointerSelectionGestures } from "./contentGesturesPointerSelection";
import { createRegionGestures } from "./contentGesturesRegion";
import {
	EDITOR_ROOT_SELECTOR,
	type ContentGestureRegionGesture,
	type ContentGesturesContext,
	type GestureSlot,
} from "./contentGesturesShared";

export type { ContentGestureRegionGesture, GestureSlot };

export interface ContentGestureState<
	InteractionModel extends PointerInteractionModel,
> {
	regionGesture: GestureSlot<ContentGestureRegionGesture | null>;
	pointerGesture: GestureSlot<PointerSelectionGesture | null>;
	pointerGestureVersion: GestureSlot<number>;
	skipNextClick: GestureSlot<boolean>;
	interactionModel: GestureSlot<InteractionModel>;
	clearPointerSelectionState(): void;
}

export interface AttachContentGesturesOptions<
	InteractionModel extends PointerInteractionModel,
> {
	editor: Editor;
	fieldEditor: FieldEditorSession;
	contentElement: HTMLElement;
	getBlocksHost: () => HTMLElement | null;
	regionSelectionStore: RegionSelectionStore;
	state: ContentGestureState<InteractionModel>;
	blockSelectionEnabled: boolean;
	runSync?: ((run: () => void) => void) | undefined;
}

export function attachContentGestures<
	InteractionModel extends PointerInteractionModel,
>(options: AttachContentGesturesOptions<InteractionModel>): () => void {
	const {
		editor,
		fieldEditor,
		contentElement: gestureEl,
		getBlocksHost,
		regionSelectionStore,
		state,
		blockSelectionEnabled,
	} = options;
	const runSync = options.runSync ?? ((run: () => void) => run());
	const {
		regionGesture: regionGestureRef,
		pointerGesture: pointerGestureRef,
		pointerGestureVersion: pointerGestureVersionRef,
		skipNextClick: skipNextClickRef,
		interactionModel: interactionModelRef,
		clearPointerSelectionState,
	} = state;

	const currentEditorRoot = gestureEl.closest(
		EDITOR_ROOT_SELECTOR,
	) as HTMLElement | null;

	const ctx: ContentGesturesContext<InteractionModel> = {
		editor,
		fieldEditor,
		gestureEl,
		currentEditorRoot,
		getBlocksHost,
		regionSelectionStore,
		regionGestureRef,
		pointerGestureRef,
		pointerGestureVersionRef,
		skipNextClickRef,
		interactionModelRef,
		clearPointerSelectionState,
		blockSelectionEnabled,
		runSync,
	};

	const pointerSelection = createPointerSelectionGestures(ctx);
	const region = createRegionGestures(ctx);
	const drag = createDragGestures(ctx);

	const handleMouseDown = (event: MouseEvent) => {
		if (event.button !== 0) return;
		if (pointerSelection.handleMouseDown(event)) return;
		if (region.handleMouseDown(event)) return;
		drag.handleMouseDown(event);
	};

	const handleRootMouseDown = (event: MouseEvent) => {
		drag.handleRootMouseDown(event, handleMouseDown);
	};

	const handleMouseMove = (event: MouseEvent) => {
		if (region.handleMouseMove(event)) return;
		drag.handleMouseMove(event);
	};

	const handleMouseUp = (event: MouseEvent) => {
		if (region.handleMouseUp(event)) return;
		pointerSelection.handleMouseUp(event);
	};

	gestureEl.addEventListener("mousedown", handleMouseDown, true);
	currentEditorRoot?.addEventListener("mousedown", handleRootMouseDown);
	gestureEl.addEventListener("click", pointerSelection.handleClick);
	gestureEl.ownerDocument?.addEventListener("mousemove", handleMouseMove);
	gestureEl.ownerDocument?.addEventListener("mouseup", handleMouseUp);

	return () => {
		gestureEl.removeEventListener("mousedown", handleMouseDown, true);
		currentEditorRoot?.removeEventListener(
			"mousedown",
			handleRootMouseDown,
		);
		gestureEl.removeEventListener("click", pointerSelection.handleClick);
		gestureEl.ownerDocument?.removeEventListener(
			"mousemove",
			handleMouseMove,
		);
		gestureEl.ownerDocument?.removeEventListener("mouseup", handleMouseUp);
		if (pointerGestureRef.current) {
			fieldEditor.notifyGestureEvent?.("pointerup");
			clearPointerSelectionState();
		}
		region.clearRegionSelectionState();
	};
}
