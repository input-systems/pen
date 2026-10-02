import type { FieldEditor, Unsubscribe } from "@input/pen-types";

import type { BlockNotifier } from "./blockNotifierTypes";

export type {
	BlockCommitSlice,
	BlockFieldSlice,
	BlockListSegment,
	BlockListSlice,
	BlockNotifier,
	BlockNotifierDiagnostics,
	BlockNotifierEventKind,
	BlockSelectionSlice,
	BlockSnapshot,
	DocumentSnapshot,
	SurfaceSnapshot,
} from "./blockNotifierTypes";

export interface FieldEditorStoreSnapshot {
	focusBlockId: string | null;
	activeBlockIds: readonly string[];
	isEditing: boolean;
	isFocused: boolean;
	isComposing: boolean;
	domSyncVersion: number;
	inputMode: "richtext" | "code" | "table" | "none";
	mode: "inactive" | "single" | "expanded" | "block";
	activeCellCoord: { blockId: string; row: number; col: number } | null;
}

export interface FieldEditorStore extends FieldEditor {
	getSnapshot(): FieldEditorStoreSnapshot;
	subscribe(callback: () => void): Unsubscribe;
	applyDocumentTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
	): void;
	applyDomTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
		options?: {
			focusBlockId?: string;
		},
	): void;
	collapseSelectionToPoint(point: { blockId: string; offset: number }): void;
	notifyDomReconciled(blockId?: string): void;
	/** Per-block state for renderers: subscribe per block here, not on the editor (SCALE6). */
	readonly blockNotifier: BlockNotifier;
}
