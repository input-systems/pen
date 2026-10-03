import type { Point } from "./changes";

/**
 * Caret display side at line-wrap and bidi-run boundaries (`03-selection.md` §1.1).
 * Meaningless for a non-collapsed text selection.
 */
export type Affinity = "upstream" | "downstream";

export type SelectionOrigin =
	| "pointer"
	| "keyboard"
	| "ime"
	| "programmatic"
	| "mapped"
	| "restore"
	| "gc";

/**
 * Options for the editor's selection setters (S3, W3.R11). `origin`
 * defaults to `"programmatic"`; `"gc"` is reserved for repair writes (A4).
 */
export interface SelectionWriteOptions {
	readonly origin?: SelectionOrigin;
}

export interface TextSelection {
	type: "text";
	anchor: Point;
	focus: Point;
	/**
	 * Written by SelectionAuthority. Absent on v1 manager
	 * objects; readers default to `"downstream"`.
	 */
	readonly affinity?: Affinity;
	/**
	 * Preserved visual x for vertical caret motion. Null unless the last
	 * motion was vertical. Written by SelectionAuthority.
	 */
	readonly goalX?: number | null;
}

export interface BlockSelection {
	type: "block";
	readonly blockIds: readonly string[];
	/** Block that extends/shrinks on shift-arrow. Written by SelectionAuthority. */
	readonly head?: string;
}

export interface AppSelection {
	type: "app";
	appId: string;
}

export interface CellSelection {
	type: "cell";
	blockId: string;
	anchor: { row: number; col: number };
	head: { row: number; col: number };
	rowIds?: string[];
	columnIds?: string[];
}

export type SelectionState =
	| TextSelection
	| BlockSelection
	| AppSelection
	| CellSelection
	| null;

/**
 * Read view of `SelectionState`. Helpers only read, so they take this
 * rather than the live writable value. Nested fields are readonly
 * (cell coords are readonly). A live `SelectionState` assigns here,
 * and so does any deep-readonly unwrap of the same value.
 */
export type ReadonlySelectionState =
	| {
			readonly type: "text";
			readonly anchor: Point;
			readonly focus: Point;
			readonly affinity?: Affinity;
			readonly goalX?: number | null;
	  }
	| {
			readonly type: "block";
			readonly blockIds: readonly string[];
			readonly head?: string;
	  }
	| {
			readonly type: "app";
			readonly appId: string;
	  }
	| {
			readonly type: "cell";
			readonly blockId: string;
			readonly anchor: { readonly row: number; readonly col: number };
			readonly head: { readonly row: number; readonly col: number };
			readonly rowIds?: readonly string[];
			readonly columnIds?: readonly string[];
	  }
	| null;

/**
 * Serializable selection as of a commit. Same variants as `SelectionState`.
 * `affinity` / `goalX` / `head` are required here because
 * `snapshotSelectionRecord` already writes them.
 *
 * Computed v1 fields (`isCollapsed` / `isMultiBlock` / `blockRange` /
 * `toRange`) live on helpers in `@input/pen-core`, not on either shape.
 */
export type SelectionRecordState =
	| {
			readonly type: "text";
			readonly anchor: Point;
			readonly focus: Point;
			readonly affinity: Affinity;
			readonly goalX: number | null;
	  }
	| {
			readonly type: "block";
			readonly blockIds: readonly string[];
			readonly head: string;
	  }
	| {
			readonly type: "app";
			readonly appId: string;
	  }
	| {
			readonly type: "cell";
			readonly blockId: string;
			readonly anchor: { readonly row: number; readonly col: number };
			readonly head: { readonly row: number; readonly col: number };
	  }
	| null;

export interface SelectionRecord {
	readonly state: SelectionRecordState;
	readonly version: number;
	readonly origin: SelectionOrigin;
	readonly commitId: number;
}
