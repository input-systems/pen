import { useCallback, useSyncExternalStore } from "react";
import type { Editor } from "@input/pen-types";

interface UndoState {
	canUndo: boolean;
	canRedo: boolean;
}

/** Live undo/redo availability for the toolbar buttons. */
export function useUndoState(editor: Editor): UndoState {
	// `useSyncExternalStore` resubscribes whenever `subscribe` changes identity,
	// so it is memoised on the editor.
	const subscribe = useCallback(
		(onChange: () => void) => editor.undoManager.onStackChange(onChange),
		[editor],
	);

	const canUndo = useSyncExternalStore(subscribe, () =>
		editor.undoManager.canUndo(),
	);
	const canRedo = useSyncExternalStore(subscribe, () =>
		editor.undoManager.canRedo(),
	);

	return { canUndo, canRedo };
}
