import type {
  BlockListSegment,
  BlockNotifier,
  BlockSnapshot,
  DocumentSnapshot,
  SurfaceSnapshot,
} from "@input/pen-dom/field-editor/store";
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  readonly,
  shallowRef,
  watch,
  type ComputedRef,
  type ShallowRef,
} from "vue";
import { useFieldEditorContext } from "./fieldEditorContext";

/**
 * Per-block state for the Vue binding comes from the field editor's block
 * notifier (SCALE6): one editor-level subscription per root, fanned out by
 * block id. Each slice is a computed over one shallow ref, and a computed
 * whose value keeps its identity does not re-trigger its readers (Vue ≥ 3.4).
 */

type BlockSlices = {
  readonly [K in Exclude<keyof BlockSnapshot, "blockId">]: ComputedRef<BlockSnapshot[K]>;
};

const MISSING_SNAPSHOT: Omit<BlockSnapshot, "blockId"> = Object.freeze({
  commit: Object.freeze({
    exists: false,
    type: null,
    props: null,
    revision: 0,
    lastOrigin: null,
    lastCommitId: 0,
  }),
  selection: Object.freeze({
    inSelection: false,
    isAnchor: false,
    isFocus: false,
    caretHere: false,
    textRange: null,
    cell: null,
  }),
  field: Object.freeze({
    isFieldFocus: false,
    isEditing: false,
    isComposing: false,
    expandedRole: null,
    domSyncVersion: 0,
    activeCell: null,
  }),
  decorations: Object.freeze([]),
  childIds: Object.freeze([]),
  list: null,
  isPlaceholderTarget: false,
  inlineCompletion: null,
  inlineCompletionVisible: false,
});

const EMPTY_SURFACE: SurfaceSnapshot = Object.freeze({
  mode: "inactive",
  activeBlockIds: Object.freeze([]),
  focusBlockId: null,
  isFocused: false,
  isEditing: false,
  isComposing: false,
});

const EMPTY_DOCUMENT: DocumentSnapshot = Object.freeze({
  rootIds: Object.freeze([]),
  isEmpty: true,
  placeholderTargetBlockId: null,
});

/** The root's notifier; null outside a `PenEditor`. */
export function useBlockNotifier(): BlockNotifier | null {
  return useFieldEditorContext()?.blockNotifier ?? null;
}

/** A shallow ref kept current by `subscribe`, released with the calling scope. */
function useNotifierRef<T>(
  read: () => T,
  subscribe: ((onChange: () => void) => () => void) | null,
): Readonly<ShallowRef<T>> {
  const value: ShallowRef<T> = shallowRef(read());
  if (subscribe) {
    const unsubscribe = subscribe(() => {
      const next = read();
      if (next !== value.value) value.value = next;
    });
    if (getCurrentScope()) onScopeDispose(unsubscribe);
  }
  return readonly(value) as Readonly<ShallowRef<T>>;
}

/** One block's slices; each re-triggers only when its own identity changes. */
export function useBlockSnapshot(blockId: string): BlockSlices {
  const notifier = useBlockNotifier();
  const snapshot = useNotifierRef<Omit<BlockSnapshot, "blockId">>(
    () => notifier?.getBlockSnapshot(blockId) ?? MISSING_SNAPSHOT,
    notifier ? (onChange) => notifier.subscribeBlock(blockId, onChange) : null,
  );
  return {
    commit: computed(() => snapshot.value.commit),
    selection: computed(() => snapshot.value.selection),
    field: computed(() => snapshot.value.field),
    decorations: computed(() => snapshot.value.decorations),
    childIds: computed(() => snapshot.value.childIds),
    list: computed(() => snapshot.value.list),
    isPlaceholderTarget: computed(() => snapshot.value.isPlaceholderTarget),
    inlineCompletion: computed(() => snapshot.value.inlineCompletion),
    inlineCompletionVisible: computed(() => snapshot.value.inlineCompletionVisible),
  };
}

/** Root ids, emptiness and the placeholder target. */
export function useDocumentSnapshot(): Readonly<ShallowRef<DocumentSnapshot>> {
  const notifier = useBlockNotifier();
  return useNotifierRef(
    () => notifier?.getDocumentSnapshot() ?? EMPTY_DOCUMENT,
    notifier ? (onChange) => notifier.subscribeDocument(onChange) : null,
  );
}

const NO_SEGMENTS: readonly BlockListSegment[] = Object.freeze([]);

/**
 * A sibling list as AX1 segments — list groups and other blocks — for the
 * root (`null`) or a container. The channel is held only while `enabled`
 * is true, so a block without children holds no subscription.
 */
export function useListSegments(
  parentId: string | null,
  enabled: () => boolean = () => true,
): Readonly<ShallowRef<readonly BlockListSegment[]>> {
  const notifier = useBlockNotifier();
  const value: ShallowRef<readonly BlockListSegment[]> = shallowRef(NO_SEGMENTS);
  if (notifier) {
    watch(
      enabled,
      (isEnabled, _previous, onCleanup) => {
        if (!isEnabled) {
          value.value = NO_SEGMENTS;
          return;
        }
        const read = () => {
          const next = notifier.getListSegments(parentId);
          if (next !== value.value) value.value = next;
        };
        read();
        onCleanup(notifier.subscribeListSegments(parentId, read));
      },
      { immediate: true },
    );
  }
  return readonly(value) as Readonly<ShallowRef<readonly BlockListSegment[]>>;
}

/** List-level field state; never changes on a DOM sync. */
export function useSurfaceSnapshot(): Readonly<ShallowRef<SurfaceSnapshot>> {
  const notifier = useBlockNotifier();
  return useNotifierRef(
    () => notifier?.getSurfaceSnapshot() ?? EMPTY_SURFACE,
    notifier ? (onChange) => notifier.subscribeSurface(onChange) : null,
  );
}
