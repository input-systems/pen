import { useRef, useSyncExternalStore } from "react";
import type { Editor } from "@input/pen-types";
import { computeDocumentEmpty } from "../utils/editorEmptyState";

export function useDocumentEmptyState(editor: Editor): boolean {
	const snapshotRef = useRef(computeDocumentEmpty(editor));

	return useSyncExternalStore(
		(callback) => editor.on("commit", () => callback()),
		() => {
			const nextSnapshot = computeDocumentEmpty(editor);
			if (snapshotRef.current === nextSnapshot) {
				return snapshotRef.current;
			}
			snapshotRef.current = nextSnapshot;
			return nextSnapshot;
		},
		() => false,
	);
}
