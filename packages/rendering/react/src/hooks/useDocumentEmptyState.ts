import { useRef, useSyncExternalStore } from "react";
import type { Editor } from "@input/pen-types";
import {
	computeDocumentEmpty,
	getDocumentPlaceholderTargetBlockId,
} from "../utils/editorEmptyState";

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

export function useDocumentPlaceholderTarget(editor: Editor): string | null {
	const snapshotRef = useRef(getDocumentPlaceholderTargetBlockId(editor));

	return useSyncExternalStore(
		(callback) => editor.on("commit", () => callback()),
		() => {
			const nextSnapshot = getDocumentPlaceholderTargetBlockId(editor);
			if (snapshotRef.current === nextSnapshot) {
				return snapshotRef.current;
			}
			snapshotRef.current = nextSnapshot;
			return nextSnapshot;
		},
		() => null,
	);
}
