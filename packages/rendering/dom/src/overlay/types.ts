import type {
	CommitEvent,
	Editor,
	SelectionRecord,
	Unsubscribe,
} from "@input/pen-types";
import type { FieldEditorSurfaceMode } from "../field-editor/crossBlock";
import type { S2ExceptionKind } from "../field-editor/selectionProjector";
import type { Affinity, Point } from "../geometry/types";

/**
 * Who a caret belongs to. `local` is the field's own caret (it blinks and
 * hides the native caret), `endpoint` an O4 range endpoint, `remote` a
 * collaborator's caret. Only `local` carets blink.
 */
export type OverlayCaretRole = "local" | "endpoint" | "remote";

/**
 * Who paints an item. `"layer"`: pen-dom paints it into the overlay layer.
 * `"binding"`: a framework binding renders it from `onPaintPlan`, as a
 * portal into the layer.
 */
export type OverlayPaintMode = "layer" | "binding";

/** A grid cell coordinate in a table block. */
export type OverlayCellCoord = { readonly row: number; readonly col: number };

/**
 * A logical overlay request from a contributor. Contributors never measure
 * (OV1, OV3): pen-dom resolves every request into a rect in the read phase.
 */
export type OverlayRequest =
	| {
			readonly kind: "caret";
			readonly key: string;
			readonly role: OverlayCaretRole;
			readonly point: Point;
			readonly affinity: Affinity;
			readonly endpoint?: "anchor" | "focus";
			readonly attributes?: Readonly<Record<string, string>>;
			/** Text painted beside the caret; remote carets carry the peer's name. */
			readonly label?: string;
			/** A remote caret's colour, written as `--pen-peer-color` on the item. */
			readonly color?: string;
			readonly paint?: OverlayPaintMode;
	  }
	| {
			readonly kind: "block-outline";
			readonly key: string;
			readonly blockId: string;
			readonly paint?: OverlayPaintMode;
	  }
	| {
			readonly kind: "block-span";
			readonly key: string;
			readonly fromBlockId: string;
			readonly toBlockId: string;
			readonly paint?: OverlayPaintMode;
	  }
	| {
			readonly kind: "cell-range";
			readonly key: string;
			readonly blockId: string;
			readonly anchor: OverlayCellCoord;
			readonly head: OverlayCellCoord;
			readonly paint?: OverlayPaintMode;
	  }
	| {
			readonly kind: "range";
			readonly key: string;
			readonly anchor: Point;
			readonly focus: Point;
			readonly paint?: OverlayPaintMode;
	  };

/** The kind of a painted item; one per request kind. W4 adds `"edge"`. */
export type OverlayItemKind = OverlayRequest["kind"];

/** One resolved, painted overlay item. Plain data. */
export interface OverlayPaintItem {
	readonly key: string;
	readonly kind: OverlayItemKind;
	readonly contributor: string;
	readonly role?: OverlayCaretRole;
	/** Layer-relative CSS pixels. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly blockId?: string;
	readonly offset?: number;
	readonly affinity?: Affinity;
	readonly endpoint?: "anchor" | "focus";
	readonly fromBlockId?: string;
	readonly toBlockId?: string;
	readonly anchorCell?: OverlayCellCoord;
	readonly headCell?: OverlayCellCoord;
	readonly attributes?: Readonly<Record<string, string>>;
	readonly label?: string;
	/** A remote caret's colour (`--pen-peer-color`). */
	readonly color?: string;
	readonly paint: OverlayPaintMode;
	/** Blink epoch for role "local", 0 otherwise. Part of the caret element's identity. */
	readonly epoch: number;
}

/** What one flush read and painted for a root. Plain data. */
export interface OverlayPaintPlan {
	/** `scheduler.diagnostics.flushCount` of the flush that read this plan. */
	readonly flush: number;
	/**
	 * Authority record version the plan was read against (OV4). A later read
	 * that resolves to identical items keeps this plan, so the layer's
	 * `data-pen-overlay-selection-version` can be newer than this field.
	 */
	readonly selectionVersion: number;
	readonly items: readonly OverlayPaintItem[];
	/** Requests whose block or cell was not mounted. The W4 Stage C hook. */
	readonly unresolved: readonly {
		readonly key: string;
		readonly contributor: string;
		readonly blockId: string;
	}[];
	/** True iff the plan holds a local caret item. Drives caret-color on the active field. */
	readonly nativeCaretHidden: boolean;
	/** True while the root's reduced-motion signal is set (AX6): the local caret gets animation none. */
	readonly solidCaret: boolean;
}

/** The field editor state a contributor decides from. */
export interface OverlayFieldState {
	readonly isEditing: boolean;
	readonly isFocused: boolean;
	readonly isComposing: boolean;
	/** The renderer `readonly` prop (`FieldEditorImpl.isReadOnly`), not the AX1 facet. */
	readonly readonly: boolean;
	readonly mode: FieldEditorSurfaceMode;
	readonly editingCell: boolean;
	/**
	 * The S2 exception in effect (D5), read from the field editor's
	 * `getSubstituteState()` in the read phase. Either kind is drawn the
	 * same way: both endpoint carets plus the range items.
	 */
	readonly substitute: S2ExceptionKind | null;
}

/** The input a contributor's `requests` receives in the read phase. */
export interface OverlayReadContext {
	readonly editor: Editor;
	readonly commits: readonly CommitEvent[];
	readonly selection: SelectionRecord;
	readonly field: OverlayFieldState;
	readonly caretMode: "auto" | "all";
}

/** A source of overlay requests: the extension point for carets and outlines. */
export interface OverlayContributor {
	readonly id: string;
	/** Pure. Called in the read phase. Must not touch the DOM or measure. */
	requests(context: OverlayReadContext): readonly OverlayRequest[];
}

/** The per-root overlay: one layer, one paint plan, and its contributors (OV1, OV2). */
export interface RootOverlay {
	readonly layer: HTMLElement;
	/** Last painted plan, or null before the first paint. */
	readonly plan: OverlayPaintPlan | null;
	/** Called in the write phase after each paint that applied a fresh read. */
	onPaintPlan(listener: (plan: OverlayPaintPlan) => void): Unsubscribe;
	/** Adds a contributor; a contributor calls `requestPaint` when its own inputs change. */
	registerContributor(contributor: OverlayContributor): Unsubscribe;
	/** Refcounted. Mode is "all" while any holder exists, "auto" otherwise. */
	holdCaretMode(mode: "all"): Unsubscribe;
	/** The local caret's default look. */
	setCaretVariant(variant: "default" | "macos"): void;
	/** Refcounted. Local caret items are painted by a binding while any holder exists. */
	holdCaretPaint(mode: "binding"): Unsubscribe;
	/** Schedule an overlay read and paint in the next flush. */
	requestPaint(): void;
}
