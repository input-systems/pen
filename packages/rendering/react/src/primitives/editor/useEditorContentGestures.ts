import { useEffect, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { Editor } from "@input/pen-types";
import {
	attachContentGestures,
	type FieldEditorSession,
	type RegionSelectionStore,
} from "@input/pen-dom";
import type {
	ResolvedBlockSelectionOptions,
	ResolvedInteractionModel,
} from "../../context/editorContext";
import type { EditorContentPointerState } from "./useEditorContentPointerState";

export interface UseEditorContentGesturesOptions extends EditorContentPointerState<ResolvedInteractionModel> {
	editor: Editor;
	readonly: boolean;
	fieldEditor: FieldEditorSession | null;
	blockSelection: ResolvedBlockSelectionOptions;
	contentRef: RefObject<HTMLElement | null>;
	blocksHostRef: RefObject<HTMLDivElement | null>;
	regionSelectionStore: RegionSelectionStore;
}

export function useEditorContentGestures(
	options: UseEditorContentGesturesOptions,
): void {
	const {
		editor,
		readonly,
		fieldEditor,
		blockSelection,
		contentRef,
		blocksHostRef,
		regionSelectionStore,
		regionGestureRef,
		pointerGestureRef,
		pointerGestureVersionRef,
		skipNextClickRef,
		interactionModelRef,
		clearPointerSelectionState,
	} = options;

	useEffect(() => {
		const contentElement = contentRef.current;
		if (!contentElement || readonly || !fieldEditor) return;

		return attachContentGestures({
			editor,
			fieldEditor,
			contentElement,
			getBlocksHost: () => blocksHostRef.current,
			regionSelectionStore,
			blockSelectionEnabled: blockSelection.enabled,
			runSync: flushSync,
			state: {
				regionGesture: regionGestureRef,
				pointerGesture: pointerGestureRef,
				pointerGestureVersion: pointerGestureVersionRef,
				skipNextClick: skipNextClickRef,
				interactionModel: interactionModelRef,
				clearPointerSelectionState,
			},
		});
	}, [
		blockSelection.enabled,
		editor,
		fieldEditor,
		readonly,
		regionSelectionStore,
	]);
}
