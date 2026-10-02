import type { Editor } from "@input/pen-types";
import { getRootBlockIds } from "@input/pen-dom/utils/parentIdTree";
import { computed, type Ref } from "vue";
import { useBlockNotifier, useDocumentSnapshot } from "../internal/blockNotifier";
import { useEditorContext } from "../internal/editorContext";
import { useExternalStore } from "../internal/useExternalStore";

/**
 * Track the document's top-level block ids as a readonly ref. Nested
 * children are not included — a layout block's children are read by the
 * block renderer that owns them. The ref only changes identity when the
 * id sequence actually changes, so editing text inside a block does not
 * re-render the list.
 */
export function useBlockList(editor?: Editor): Readonly<Ref<readonly string[]>> {
  const resolvedEditor = editor ?? useEditorContext().editor;
  // Inside a root and for its own editor, the notifier's root ids:
  // recomputed only on structural commits, so a text-only commit does not
  // spread the order (SCALE6).
  if (!editor && useBlockNotifier()) {
    const documentSnapshot = useDocumentSnapshot();
    return computed(() => documentSnapshot.value.rootIds);
  }

  return useExternalStore(
    (callback) => resolvedEditor.on("commit", () => callback()),
    () => [...getRootBlockIds(resolvedEditor)],
    stringArrayEqual,
  );
}

function stringArrayEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
