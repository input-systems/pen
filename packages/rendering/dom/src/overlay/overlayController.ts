import {
	getEditorSelectionRecord,
	getOpOriginType,
	getSelectionBlockRange,
} from "@input/pen-core";
import type {
	CommitEvent,
	Editor,
	SelectionOrigin,
	SelectionRecord,
	Unsubscribe,
} from "@input/pen-types";
import {
	getRootReducedMotion,
	REDUCED_MOTION_ATTR,
	type ReducedMotionSignal,
} from "../a11y/motion";
import { shouldUseBlockSelection } from "../field-editor/crossBlock";
import type { FieldEditorStoreSnapshot } from "../field-editor/store";
import { elementRect, measureCellRect } from "../geometry/geometryMeasure";
import type { GeometryReaderHost } from "../geometry/geometryReader";
import type { Point, Rect } from "../geometry/types";
import type { DomScheduler, OverlayPainter } from "../scheduler";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { createOverlayLayerElement, OverlayLayerPainter } from "./overlayLayer";
import type { OverlayCaretVariant } from "./overlayStyles";
import type {
	OverlayContributor,
	OverlayFieldState,
	OverlayPaintItem,
	OverlayPaintPlan,
	OverlayReadContext,
	OverlayRequest,
	RootOverlay,
} from "./types";

/**
 * What the controller reads from the field editor. `FieldEditorImpl`
 * satisfies it, and forwards its own selection and state changes through
 * `notifySelectionChange` and `notifyFieldChange`, so the overlay adds no
 * editor or store subscription of its own.
 */
export type OverlayFieldSource = {
	readonly isReadOnly: boolean;
	getSnapshot(): Pick<
		FieldEditorStoreSnapshot,
		"isEditing" | "isFocused" | "isComposing" | "mode" | "activeCellCoord"
	>;
};

export type OverlayControllerOptions = {
	readonly root: HTMLElement;
	readonly editor: Editor;
	readonly field: OverlayFieldSource;
	readonly reader: GeometryReaderHost;
	readonly scheduler: DomScheduler;
	/** Defaults to a handle on the root's shared signal, released by the controller. */
	readonly reducedMotion?: ReducedMotionSignal;
};

/** Caret writes that restart the blink phase (O preamble). */
const BLINK_RESTART_ORIGINS: ReadonlySet<SelectionOrigin> = new Set([
	"pointer",
	"keyboard",
	"ime",
]);

const NULL_RECORD: SelectionRecord = {
	state: null,
	version: 0,
	origin: "programmatic",
	commitId: 0,
};

type ReadInputs = {
	readonly selectionVersion: number;
	readonly field: string;
	readonly generation: number;
	readonly solidCaret: boolean;
	readonly epoch: number;
};

type Unresolved = OverlayPaintPlan["unresolved"][number];

/**
 * The per-root overlay (OV1, OV2). Contributors turn the selection record
 * and field state into logical requests; `read` resolves them through the
 * root's GeometryReader in the scheduler's read phase, and `paint` applies
 * the plan to the layer in the write phase. Nothing here schedules on its
 * own clock: every repaint is a `requestPaint` coalesced into a flush (S4).
 */
export class OverlayController implements RootOverlay, OverlayPainter {
	readonly layer: HTMLElement;
	private readonly root: HTMLElement;
	private readonly editor: Editor;
	private field: OverlayFieldSource;
	private readonly reader: GeometryReaderHost;
	private readonly scheduler: DomScheduler;
	private readonly sharedReducedMotion: ReducedMotionSignal | null;
	private reducedMotion: ReducedMotionSignal | null = null;
	private readonly painter: OverlayLayerPainter;
	private readonly listeners = new Set<(plan: OverlayPaintPlan) => void>();
	private readonly contributors: OverlayContributor[] = [];
	private readonly hiddenCarets = new Map<HTMLElement, string>();
	private readonly unsubscribers: Unsubscribe[] = [];
	private _plan: OverlayPaintPlan | null = null;
	private pending: OverlayPaintPlan | null = null;
	private lastInputs: ReadInputs | null = null;
	private fieldKey: string;
	private dirty = true;
	private caretModeHolds = 0;
	private caretPaintHolds = 0;
	private variant: OverlayCaretVariant = "default";
	private paintedVariant: OverlayCaretVariant = "default";
	private epoch = 0;
	private caretMoved = false;
	private paintedLocalCaret: Point | null = null;
	private substitute: {
		readonly version: number;
		readonly value: OverlayFieldState["substitute"];
	} | null = null;
	private attached = false;
	private disposed = false;

	constructor(options: OverlayControllerOptions) {
		this.root = options.root;
		this.editor = options.editor;
		this.field = options.field;
		this.reader = options.reader;
		this.scheduler = options.scheduler;
		this.sharedReducedMotion = options.reducedMotion ?? null;
		this.layer = createOverlayLayerElement(options.root.ownerDocument);
		this.painter = new OverlayLayerPainter(this.layer);
		this.fieldKey = fieldStateKey(this.readFieldState(null));
	}

	/** The editor this overlay draws. A root re-attached to another editor gets a new overlay. */
	get editorInstance(): Editor {
		return this.editor;
	}

	/** Whether the overlay is attached: its layer is in the root and the scheduler paints it. */
	get isAttached(): boolean {
		return this.attached;
	}

	/**
	 * Attach (or re-attach) to the root: append the layer as the root's last
	 * child, install the painter, and subscribe to geometry and motion.
	 * Contributors and holds survive a detach and re-attach of the same root,
	 * so a binding that registered against this overlay keeps working when the
	 * field editor re-attaches the root (React Strict Mode does).
	 */
	attach(field: OverlayFieldSource): void {
		if (this.disposed) {
			return;
		}
		this.field = field;
		if (this.attached) {
			return;
		}
		this.attached = true;
		this.root.appendChild(this.layer);
		this.scheduler.setOverlayPainter(this);
		this.reducedMotion =
			this.sharedReducedMotion ?? getRootReducedMotion(this.root);
		const motion = this.reducedMotion;
		this.unsubscribers.push(
			this.reader.onGenerationBump(() => {
				this.requestPaintForInputs();
			}),
			motion.subscribe(() => {
				this.requestPaintForInputs();
			}),
		);
		this.fieldKey = fieldStateKey(this.readFieldState(null));
		this.requestPaint();
	}

	/**
	 * Detach from the root: remove the layer and the painter, restore the
	 * native caret, and drop the painted plan. Contributors and holds stay.
	 */
	detach(): void {
		if (!this.attached) {
			return;
		}
		this.attached = false;
		for (const unsubscribe of this.unsubscribers.splice(0)) {
			unsubscribe();
		}
		if (this.reducedMotion !== this.sharedReducedMotion) {
			this.reducedMotion?.dispose();
		}
		this.reducedMotion = null;
		this.scheduler.setOverlayPainter(null);
		this.syncNativeCaret(false);
		this.syncReducedMotionAttr(false);
		this.painter.clear();
		// The layer keeps its OV4 attributes while detached: the first paint
		// after a re-attach rewrites them only if they changed, and a detach
		// on teardown writes nothing but the removal.
		this.layer.remove();
		this._plan = null;
		this.pending = null;
		this.lastInputs = null;
		this.paintedLocalCaret = null;
		this.dirty = true;
	}

	get plan(): OverlayPaintPlan | null {
		return this._plan;
	}

	/** Blink epoch of the local caret (§3.7): advances once per user commit or pointer, keyboard or ime caret move. */
	get blinkEpoch(): number {
		return this.epoch;
	}

	onPaintPlan(listener: (plan: OverlayPaintPlan) => void): Unsubscribe {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	registerContributor(contributor: OverlayContributor): Unsubscribe {
		this.contributors.push(contributor);
		this.requestPaint();
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
			const index = this.contributors.indexOf(contributor);
			if (index !== -1) {
				this.contributors.splice(index, 1);
			}
			this.requestPaint();
		};
	}

	holdCaretMode(_mode: "all"): Unsubscribe {
		this.caretModeHolds += 1;
		this.requestPaint();
		return this.releaseOnce(() => {
			this.caretModeHolds -= 1;
		});
	}

	setCaretVariant(variant: OverlayCaretVariant): void {
		if (this.variant === variant) {
			return;
		}
		this.variant = variant;
		this.requestPaint();
	}

	holdCaretPaint(_mode: "binding"): Unsubscribe {
		this.caretPaintHolds += 1;
		this.requestPaint();
		return this.releaseOnce(() => {
			this.caretPaintHolds -= 1;
		});
	}

	requestPaint(): void {
		if (this.disposed || !this.attached) {
			return;
		}
		this.dirty = true;
		this.scheduler.requestPaint();
	}

	/** The field editor's selection listener forwards every record here. */
	notifySelectionChange(record: SelectionRecord): void {
		this.noteCaretMove(record);
		// OV4: the layer's painted version follows every record.
		this.requestPaint();
	}

	/** The field editor forwards its state changes here; only overlay-relevant ones repaint. */
	notifyFieldChange(): void {
		const key = fieldStateKey(this.readFieldState(null));
		if (key === this.fieldKey) {
			return;
		}
		this.fieldKey = key;
		this.requestPaintForInputs();
	}

	/**
	 * Mount acks and geometry, focus or motion changes only matter when
	 * something could be painted: with no contributor and an empty layer
	 * they cost no flush.
	 */
	requestPaintForInputs(): void {
		if (this.contributors.length === 0 && !this._plan?.items.length) {
			return;
		}
		this.requestPaint();
	}

	read(input: { readonly commits: readonly CommitEvent[] }): void {
		if (this.disposed || !this.attached) {
			return;
		}
		// §3.7: one restart per user commit; a pointer, keyboard or ime caret
		// move restarts once when no user commit already did (the caret move
		// that follows a typed character is part of that character).
		const userCommits = input.commits.filter(isUserCommit).length;
		this.epoch += userCommits > 0 ? userCommits : this.caretMoved ? 1 : 0;
		this.caretMoved = false;

		const selection = getEditorSelectionRecord(this.editor) ?? NULL_RECORD;
		const field = this.readFieldState(selection);
		const solidCaret = this.reducedMotion?.reduced ?? false;
		const inputs: ReadInputs = {
			selectionVersion: selection.version,
			field: fieldStateKey(field),
			generation: this.reader.generation,
			solidCaret,
			epoch: this.epoch,
		};
		if (
			!this.dirty &&
			this.lastInputs &&
			inputsEqual(this.lastInputs, inputs)
		) {
			return;
		}
		this.dirty = false;

		const context: OverlayReadContext = {
			editor: this.editor,
			commits: input.commits,
			selection,
			field,
			caretMode: this.caretModeHolds > 0 ? "all" : "auto",
		};
		const requests = this.collectRequests(context);
		const { items, unresolved } =
			requests.length === 0
				? { items: [], unresolved: [] }
				: this.resolve(requests);
		this.pending = {
			flush: this.scheduler.diagnostics.flushCount,
			selectionVersion: selection.version,
			items,
			unresolved,
			nativeCaretHidden: items.some(isLocalCaret),
			solidCaret,
		};
		// The reads above may have refreshed cache entries, which moves the
		// generation; record it after measuring so our own reads do not
		// count as a change next flush.
		this.lastInputs = { ...inputs, generation: this.reader.generation };
	}

	paint(input: { readonly ranWrites: boolean }): void {
		if (this.disposed || !this.attached) {
			return;
		}
		const next = this.pending;
		this.pending = null;
		if (next) {
			const previous = this._plan;
			if (
				!previous ||
				!plansEqual(previous, next) ||
				this.variant !== this.paintedVariant
			) {
				this.painter.apply(next.items, {
					variant: this.variant,
					solidCaret: next.solidCaret,
				});
				this._plan = next;
				this.paintedVariant = this.variant;
				const local = next.items.find(isLocalCaret);
				this.paintedLocalCaret =
					local?.blockId !== undefined && local.offset !== undefined
						? { blockId: local.blockId, offset: local.offset }
						: null;
			}
			const painted = this._plan ?? next;
			this.writeLayerState(painted);
			this.syncNativeCaret(painted.nativeCaretHidden);
			this.syncReducedMotionAttr(painted.solidCaret);
			for (const listener of [...this.listeners]) {
				listener(painted);
			}
		}
		// Stale-after-write: queued writes may have moved what this plan
		// measured. One follow-up paint-only flush re-reads; it runs no
		// writes, so it requests nothing further.
		if (input.ranWrites && (this._plan?.items.length ?? 0) > 0) {
			this.requestPaint();
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.detach();
		this.disposed = true;
		this.listeners.clear();
		this.contributors.length = 0;
	}

	private releaseOnce(release: () => void): Unsubscribe {
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
			release();
			this.requestPaint();
		};
	}

	private noteCaretMove(record: SelectionRecord): void {
		if (!BLINK_RESTART_ORIGINS.has(record.origin)) {
			return;
		}
		if (record.state?.type !== "text") {
			return;
		}
		const focus = record.state.focus;
		const painted = this.paintedLocalCaret;
		if (
			painted &&
			painted.blockId === focus.blockId &&
			painted.offset === focus.offset
		) {
			return;
		}
		this.caretMoved = true;
	}

	private readFieldState(
		selection: SelectionRecord | null,
	): OverlayFieldState {
		const snapshot = this.field.getSnapshot();
		return {
			isEditing: snapshot.isEditing,
			isFocused: snapshot.isFocused,
			isComposing: snapshot.isComposing,
			readonly: this.field.isReadOnly,
			mode: snapshot.mode,
			editingCell: snapshot.activeCellCoord !== null,
			substitute: selection ? this.substituteFor(selection) : null,
		};
	}

	/**
	 * Until W3's substitute-state accessor lands, the S2 exception drawn here
	 * is the >50-block text range, computed once per record version.
	 */
	private substituteFor(
		selection: SelectionRecord,
	): OverlayFieldState["substitute"] {
		if (this.substitute?.version === selection.version) {
			return this.substitute.value;
		}
		const state = selection.state;
		let value: OverlayFieldState["substitute"] = null;
		if (
			state?.type === "text" &&
			state.anchor.blockId !== state.focus.blockId
		) {
			const range = getSelectionBlockRange(this.editor.documentState, {
				type: "text",
				anchor: state.anchor,
				focus: state.focus,
			});
			value = shouldUseBlockSelection(this.editor, range.length)
				? "block-surface-range"
				: null;
		}
		this.substitute = { version: selection.version, value };
		return value;
	}

	private collectRequests(
		context: OverlayReadContext,
	): { readonly contributor: string; readonly request: OverlayRequest }[] {
		const collected: {
			readonly contributor: string;
			readonly request: OverlayRequest;
		}[] = [];
		for (const contributor of this.contributors) {
			try {
				for (const request of contributor.requests(context)) {
					collected.push({ contributor: contributor.id, request });
				}
			} catch (error) {
				this.editor.internals.emit("diagnostic", {
					code: "overlay-contributor-failed",
					level: "warn",
					source: "overlay",
					message: `overlay contributor "${contributor.id}" threw while building requests; its items are dropped for this flush`,
					error,
				});
			}
		}
		return collected;
	}

	/** Read phase only: every rect comes from the root's GeometryReader (SCH1). */
	private resolve(
		requests: readonly {
			readonly contributor: string;
			readonly request: OverlayRequest;
		}[],
	): { items: OverlayPaintItem[]; unresolved: Unresolved[] } {
		const origin = elementRect(this.layer);
		const items: OverlayPaintItem[] = [];
		const unresolved: Unresolved[] = [];
		for (const { contributor, request } of requests) {
			this.resolveRequest(
				contributor,
				request,
				origin,
				items,
				unresolved,
			);
		}
		return { items, unresolved };
	}

	private resolveRequest(
		contributor: string,
		request: OverlayRequest,
		origin: Rect,
		items: OverlayPaintItem[],
		unresolved: Unresolved[],
	): void {
		const base = {
			key: request.key,
			kind: request.kind,
			contributor,
			paint: request.paint ?? ("layer" as const),
			epoch: 0,
		};
		switch (request.kind) {
			case "caret": {
				const rect = this.reader.caretRect(
					request.point,
					request.affinity,
				);
				if (!rect) {
					unresolved.push({
						key: request.key,
						contributor,
						blockId: request.point.blockId,
					});
					return;
				}
				const local = request.role === "local";
				items.push({
					...base,
					...relative(rect, origin),
					role: request.role,
					blockId: request.point.blockId,
					offset: request.point.offset,
					affinity: request.affinity,
					endpoint: request.endpoint,
					attributes: request.attributes,
					label: request.label,
					paint:
						local && this.caretPaintHolds > 0
							? "binding"
							: base.paint,
					epoch: local ? this.epoch : 0,
				});
				return;
			}
			case "block-outline": {
				const rect = this.reader.blockRect(request.blockId);
				if (!rect) {
					unresolved.push({
						key: request.key,
						contributor,
						blockId: request.blockId,
					});
					return;
				}
				items.push({
					...base,
					...relative(rect, origin),
					blockId: request.blockId,
				});
				return;
			}
			case "block-span": {
				const from = this.reader.blockRect(request.fromBlockId);
				const to = this.reader.blockRect(request.toBlockId);
				if (!from || !to) {
					unresolved.push({
						key: request.key,
						contributor,
						blockId: from ? request.toBlockId : request.fromBlockId,
					});
					return;
				}
				items.push({
					...base,
					...relative(unionRect(from, to), origin),
					fromBlockId: request.fromBlockId,
					toBlockId: request.toBlockId,
				});
				return;
			}
			case "cell-range": {
				// Two cell reads: the rectangle's top-left and bottom-right cells.
				const top = Math.min(request.anchor.row, request.head.row);
				const bottom = Math.max(request.anchor.row, request.head.row);
				const left = Math.min(request.anchor.col, request.head.col);
				const right = Math.max(request.anchor.col, request.head.col);
				const start = measureCellRect(
					this.root,
					request.blockId,
					top,
					left,
				);
				const end = measureCellRect(
					this.root,
					request.blockId,
					bottom,
					right,
				);
				if (!start || !end) {
					unresolved.push({
						key: request.key,
						contributor,
						blockId: request.blockId,
					});
					return;
				}
				items.push({
					...base,
					...relative(unionRect(start, end), origin),
					blockId: request.blockId,
					anchorCell: request.anchor,
					headCell: request.head,
				});
				return;
			}
			case "range": {
				const rects = this.reader.rangeRects({
					anchor: request.anchor,
					focus: request.focus,
				});
				if (rects.length === 0) {
					unresolved.push({
						key: request.key,
						contributor,
						blockId: request.anchor.blockId,
					});
					return;
				}
				rects.forEach((rect, index) => {
					items.push({
						...base,
						...relative(rect, origin),
						key: `${request.key}:${index}`,
					});
				});
				return;
			}
			default: {
				const _exhaustive: never = request;
				return _exhaustive;
			}
		}
	}

	/** Write phase: OV4's painted version and the caret-visible flag on the layer. */
	private writeLayerState(plan: OverlayPaintPlan): void {
		const version = String(plan.selectionVersion);
		if (
			this.layer.getAttribute(OVERLAY_SELECTION_VERSION_ATTR) !== version
		) {
			this.layer.setAttribute(OVERLAY_SELECTION_VERSION_ATTR, version);
		}
		const caretVisible = this.layer.hasAttribute(CARET_VISIBLE_ATTR);
		if (plan.nativeCaretHidden && !caretVisible) {
			this.layer.setAttribute(CARET_VISIBLE_ATTR, "");
		} else if (!plan.nativeCaretHidden && caretVisible) {
			this.layer.removeAttribute(CARET_VISIBLE_ATTR);
		}
	}

	/** Write phase: AX6's presence-only root attribute (HOST6). */
	private syncReducedMotionAttr(reduced: boolean): void {
		// Library and host transitions select on it.
		if (this.root.hasAttribute(REDUCED_MOTION_ATTR) !== reduced) {
			this.root.toggleAttribute(REDUCED_MOTION_ATTR, reduced);
		}
	}

	/**
	 * Write phase: while a local caret is painted the active field surfaces
	 * carry inline `caret-color: transparent`; each element's previous inline
	 * value comes back when the caret goes or the element leaves the set.
	 */
	private syncNativeCaret(hidden: boolean): void {
		const surfaces = hidden
			? new Set(
					this.root.querySelectorAll<HTMLElement>(
						`[${DATA_ATTRS.fieldEditorActiveSurface}]`,
					),
				)
			: new Set<HTMLElement>();
		for (const [surface, previous] of this.hiddenCarets) {
			if (!surfaces.has(surface)) {
				surface.style.caretColor = previous;
				this.hiddenCarets.delete(surface);
			}
		}
		for (const surface of surfaces) {
			if (!this.hiddenCarets.has(surface)) {
				this.hiddenCarets.set(surface, surface.style.caretColor);
				surface.style.caretColor = "transparent";
			}
		}
	}
}

/** OV4: the authority record version the layer last painted. */
export const OVERLAY_SELECTION_VERSION_ATTR =
	"data-pen-overlay-selection-version";
const CARET_VISIBLE_ATTR = "data-caret-visible";

function isUserCommit(event: CommitEvent): boolean {
	return getOpOriginType(event.origin) === "user";
}

function isLocalCaret(item: OverlayPaintItem): boolean {
	return item.kind === "caret" && item.role === "local";
}

function fieldStateKey(field: OverlayFieldState): string {
	return [
		field.isEditing,
		field.isFocused,
		field.isComposing,
		field.readonly,
		field.mode,
		field.editingCell,
	].join("|");
}

function inputsEqual(left: ReadInputs, right: ReadInputs): boolean {
	return (
		left.selectionVersion === right.selectionVersion &&
		left.field === right.field &&
		left.generation === right.generation &&
		left.solidCaret === right.solidCaret &&
		left.epoch === right.epoch
	);
}

function relative(
	rect: Rect,
	origin: Rect,
): Pick<OverlayPaintItem, "x" | "y" | "width" | "height"> {
	return {
		x: rect.left - origin.left,
		y: rect.top - origin.top,
		width: rect.width,
		height: rect.height,
	};
}

function unionRect(a: Rect, b: Rect): Rect {
	const left = Math.min(a.left, b.left);
	const top = Math.min(a.top, b.top);
	const right = Math.max(a.right, b.right);
	const bottom = Math.max(a.bottom, b.bottom);
	return {
		x: left,
		y: top,
		left,
		top,
		right,
		bottom,
		width: right - left,
		height: bottom - top,
	};
}

/** Plans paint the same when everything but the flush number matches. */
function plansEqual(left: OverlayPaintPlan, right: OverlayPaintPlan): boolean {
	if (
		left.selectionVersion !== right.selectionVersion ||
		left.nativeCaretHidden !== right.nativeCaretHidden ||
		left.solidCaret !== right.solidCaret ||
		left.items.length !== right.items.length ||
		left.unresolved.length !== right.unresolved.length
	) {
		return false;
	}
	for (let index = 0; index < left.items.length; index += 1) {
		if (!itemsEqual(left.items[index]!, right.items[index]!)) {
			return false;
		}
	}
	for (let index = 0; index < left.unresolved.length; index += 1) {
		const a = left.unresolved[index]!;
		const b = right.unresolved[index]!;
		if (
			a.key !== b.key ||
			a.contributor !== b.contributor ||
			a.blockId !== b.blockId
		) {
			return false;
		}
	}
	return true;
}

function itemsEqual(left: OverlayPaintItem, right: OverlayPaintItem): boolean {
	return (
		left.key === right.key &&
		left.kind === right.kind &&
		left.contributor === right.contributor &&
		left.role === right.role &&
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height &&
		left.blockId === right.blockId &&
		left.offset === right.offset &&
		left.affinity === right.affinity &&
		left.endpoint === right.endpoint &&
		left.fromBlockId === right.fromBlockId &&
		left.toBlockId === right.toBlockId &&
		cellEqual(left.anchorCell, right.anchorCell) &&
		cellEqual(left.headCell, right.headCell) &&
		left.label === right.label &&
		left.paint === right.paint &&
		left.epoch === right.epoch &&
		recordsEqual(left.attributes, right.attributes)
	);
}

function cellEqual(
	left: OverlayPaintItem["anchorCell"],
	right: OverlayPaintItem["anchorCell"],
): boolean {
	return left?.row === right?.row && left?.col === right?.col;
}

function recordsEqual(
	left: Readonly<Record<string, string>> | undefined,
	right: Readonly<Record<string, string>> | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	const leftKeys = Object.keys(left ?? {});
	const rightKeys = Object.keys(right ?? {});
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}
	return leftKeys.every((key) => left?.[key] === right?.[key]);
}
