import {
	CLOSED_GESTURE_WINDOWS,
	type GestureEventKind,
} from "../selectionReader";

/**
 * The sub-controllers a stub field-editor controller hands its backend
 * (`FieldEditorParts`): an idle reader, a projector that allows the
 * post-rebuild write, and no pending marks.
 */
export function stubFieldEditorParts(
	options: {
		onGesture?: (kind: GestureEventKind) => void;
		shouldProjectSelectionAfterReconcile?: boolean;
	} = {},
) {
	return {
		reader: {
			windows: CLOSED_GESTURE_WINDOWS,
			notifyGesture: (kind: GestureEventKind) =>
				options.onGesture?.(kind),
			fieldOffsets: () => null,
			hasSelectionInRoot: () => false,
			isAdmissibleRead: () => false,
		},
		projector: {
			shouldProjectSelectionAfterReconcile: () =>
				options.shouldProjectSelectionAfterReconcile ?? true,
		},
		pendingMarks: {
			resolveInsertMarks: () => undefined,
		},
	};
}
