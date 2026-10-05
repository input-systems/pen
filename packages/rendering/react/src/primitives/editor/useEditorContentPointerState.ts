import { useRef } from "react";
import type { RefObject } from "react";
import type { PointerSelectionGesture } from "@input/pen-dom/utils/pointerSelection";

export interface EditorContentRegionGesture {
	clientX: number;
	clientY: number;
	isSelecting: boolean;
}

export interface EditorContentPointerState<InteractionModel> {
	regionGestureRef: RefObject<EditorContentRegionGesture | null>;
	pointerGestureRef: RefObject<PointerSelectionGesture | null>;
	pointerGestureVersionRef: RefObject<number>;
	interactionModelRef: RefObject<InteractionModel>;
	clearPointerSelectionState(): void;
}

export function useEditorContentPointerState<InteractionModel>(
	interactionModel: InteractionModel,
): EditorContentPointerState<InteractionModel> {
	const regionGestureRef = useRef<EditorContentRegionGesture | null>(null);
	const pointerGestureRef = useRef<PointerSelectionGesture | null>(null);
	const pointerGestureVersionRef = useRef(0);
	const interactionModelRef = useRef(interactionModel);
	interactionModelRef.current = interactionModel;
	function clearPointerSelectionState(): void {
		pointerGestureRef.current = null;
	}

	return {
		regionGestureRef,
		pointerGestureRef,
		pointerGestureVersionRef,
		interactionModelRef,
		clearPointerSelectionState,
	};
}
