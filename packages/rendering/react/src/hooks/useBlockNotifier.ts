import type {
	BlockNotifier,
	BlockSnapshot,
	DocumentSnapshot,
	SurfaceSnapshot,
} from "@input/pen-dom/field-editor/store";
import type { Unsubscribe } from "@input/pen-types";
import { useCallback, useSyncExternalStore } from "react";

import { useFieldEditorContext } from "../context/fieldEditorContext";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";

/**
 * Per-block state for the React binding comes from the root's block notifier
 * (SCALE6): one editor-level subscription per root, fanned out by block id.
 * Subscribe and getSnapshot are memoized on (notifier, blockId, key) because
 * `useSyncExternalStore` resubscribes whenever their identity changes — a
 * semantic need, not a render optimisation (this package is not compiled with
 * React Compiler).
 */

const NO_SUBSCRIPTION = (): Unsubscribe => () => {};

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

/** The root's notifier; null outside an `EditorRoot`. */
export function useBlockNotifier(): BlockNotifier | null {
	return useFieldEditorContext()?.blockNotifier ?? null;
}

/** One slice of one block; re-renders only when that slice's identity changes. */
export function useBlockSlice<K extends Exclude<keyof BlockSnapshot, "blockId">>(
	blockId: string,
	key: K,
): BlockSnapshot[K] {
	const notifier = useBlockNotifier();
	const subscribe = useCallback(
		(onChange: () => void) => notifier?.subscribeBlock(blockId, onChange) ?? NO_SUBSCRIPTION(),
		[notifier, blockId],
	);
	const getSnapshot = useCallback(
		(): BlockSnapshot[K] =>
			notifier ? notifier.getBlockSnapshot(blockId)[key] : (MISSING_SNAPSHOT[key] as BlockSnapshot[K]),
		[notifier, blockId, key],
	);
	const getServerSnapshot = useCallback(() => MISSING_SNAPSHOT[key] as BlockSnapshot[K], [key]);
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// HOST5: SSR renders the shell only, so the server snapshots are empty.
const serverSurface = (): SurfaceSnapshot => EMPTY_SURFACE;
const serverDocument = (): DocumentSnapshot => EMPTY_DOCUMENT;

/** Root ids, emptiness and the placeholder target; recomputed only when they change. */
export function useDocumentSnapshot(): DocumentSnapshot {
	const notifier = useBlockNotifier();
	const subscribe = useCallback(
		(onChange: () => void) => notifier?.subscribeDocument(onChange) ?? NO_SUBSCRIPTION(),
		[notifier],
	);
	const getSnapshot = useCallback(() => notifier?.getDocumentSnapshot() ?? EMPTY_DOCUMENT, [notifier]);
	return useSyncExternalStore(subscribe, getSnapshot, serverDocument);
}

interface SurfaceExpansion {
	readonly expanded: boolean;
	/** The expanded surface's blocks; empty otherwise. */
	readonly activeBlockIds: readonly string[];
}

/**
 * One object for every non-expanded mode: a focus move flips the mode through
 * "inactive" within one batch, and any change there would schedule a list
 * render even when the mode ends where it started.
 */
const NOT_EXPANDED: SurfaceExpansion = Object.freeze({ expanded: false, activeBlockIds: Object.freeze([]) });

function selectExpansion(surface: SurfaceSnapshot): SurfaceExpansion {
	return surface.mode === "expanded"
		? { expanded: true, activeBlockIds: surface.activeBlockIds }
		: NOT_EXPANDED;
}

function sameExpansion(left: SurfaceExpansion, right: SurfaceExpansion): boolean {
	return left.expanded === right.expanded && left.activeBlockIds === right.activeBlockIds;
}

/**
 * Whether the surface is expanded, and over which blocks: a focus move does
 * not re-render the list component that reads it (SCALE6).
 */
export function useSurfaceExpansion(): SurfaceExpansion {
	const notifier = useBlockNotifier();
	const subscribe = useCallback(
		(onChange: () => void) => notifier?.subscribeSurface(onChange) ?? NO_SUBSCRIPTION(),
		[notifier],
	);
	const getSnapshot = useCallback(() => notifier?.getSurfaceSnapshot() ?? EMPTY_SURFACE, [notifier]);
	return useSyncExternalStoreWithSelector(subscribe, getSnapshot, serverSurface, selectExpansion, sameExpansion);
}
