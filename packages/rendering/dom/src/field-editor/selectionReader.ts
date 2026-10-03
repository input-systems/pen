import {
	buildLazyNormalPositionSnapshot,
	getEditorSelectionRecord,
	snapToNormalPosition,
} from "@input/pen-core";
import type { Editor, Point, SelectionRecordState } from "@input/pen-types";
import { toLogicalOffset } from "./offsetDomain";
import {
	domPointToOffset,
	mapDomSelectionToEditor,
	type DirectionalSelectionOffsets,
	type SelectionPoint,
} from "./selectionMapping";
import { normalizeSelectionFormation } from "../utils/selectionFormation";

export type ReaderPoint = Point;

export type ReaderSelection =
	| {
			readonly type: "text";
			readonly anchor: ReaderPoint;
			readonly focus: ReaderPoint;
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
	  }
	| null;

export type ReaderAtomExtent = {
	readonly start: number;
	readonly end: number;
};

export type ReaderBlockKind = "text" | "structural";

export type ReaderBlock = {
	readonly kind: ReaderBlockKind;
	readonly text: string;
	readonly atoms?: readonly ReaderAtomExtent[];
};

export type ReaderSnapshot = {
	readonly blockOrder: readonly string[];
	readonly blocks: Readonly<Record<string, ReaderBlock>>;
	/** Visibility without materialising `blockOrder` (SCALE2). */
	readonly has?: (blockId: string) => boolean;
};

type GestureWindowKind = "pointer" | "ime" | "context-menu" | "drag";

export type GestureWindowState = {
	readonly pointer: boolean;
	readonly ime: boolean;
	readonly contextMenu: boolean;
	readonly drag: boolean;
};

export const CLOSED_GESTURE_WINDOWS: GestureWindowState = {
	pointer: false,
	ime: false,
	contextMenu: false,
	drag: false,
};

export type GestureEventKind =
	| "pointerdown"
	| "pointerup"
	| "pointer-settled"
	| "compositionstart"
	| "compositionend-completed"
	| "contextmenu"
	| "selectionchange"
	| "dragstart"
	| "drop-completed"
	| "dragend-completed"
	| "keydown"
	| "keyup";

export type DomSelectionReadDecision =
	"ignore-inflight" | "no-proposal" | "equivalent" | "diverge" | "accept";

export type GestureSelectionOrigin = "pointer" | "ime";

export function isLogicallyEquivalent(
	domRead: ReaderSelection,
	authorityState: ReaderSelection,
	snapshot: ReaderSnapshot,
): boolean {
	if (domRead === null && authorityState === null) {
		return true;
	}
	if (domRead === null || authorityState === null) {
		return false;
	}
	if (domRead.type !== authorityState.type) {
		return false;
	}

	switch (domRead.type) {
		case "text": {
			if (authorityState.type !== "text") {
				return false;
			}
			return (
				sameSnappedPoint(
					domRead.anchor,
					authorityState.anchor,
					snapshot,
				) &&
				sameSnappedPoint(domRead.focus, authorityState.focus, snapshot)
			);
		}
		case "block": {
			if (authorityState.type !== "block") {
				return false;
			}
			return (
				sameBlockIds(domRead.blockIds, authorityState.blockIds) &&
				defaultBlockHead(domRead) === defaultBlockHead(authorityState)
			);
		}
		case "app": {
			if (authorityState.type !== "app") {
				return false;
			}
			return domRead.appId === authorityState.appId;
		}
		case "cell": {
			if (authorityState.type !== "cell") {
				return false;
			}
			return (
				domRead.blockId === authorityState.blockId &&
				domRead.anchor.row === authorityState.anchor.row &&
				domRead.anchor.col === authorityState.anchor.col &&
				domRead.head.row === authorityState.head.row &&
				domRead.head.col === authorityState.head.col
			);
		}
		default: {
			const _exhaustive: never = domRead;
			return _exhaustive;
		}
	}
}

/**
 * §4.2 steps 1–5. A proposal is accepted only inside an open gesture
 * window. Closed-window divergence does not write the authority (I4).
 */
export function classifyDomSelectionRead(input: {
	projectionInFlight: boolean;
	proposal: ReaderSelection | null;
	authorityState: ReaderSelection;
	snapshot: ReaderSnapshot;
	gestureWindows: GestureWindowState;
}): DomSelectionReadDecision {
	if (input.projectionInFlight) {
		return "ignore-inflight";
	}
	if (input.proposal === null) {
		return "no-proposal";
	}
	if (
		isLogicallyEquivalent(
			input.proposal,
			input.authorityState,
			input.snapshot,
		)
	) {
		return "equivalent";
	}
	if (!isAdmissibleDomRead("selectionchange", input.gestureWindows)) {
		return "diverge";
	}
	return "accept";
}

/** Reader step 3 against the record alone: the read changes nothing. */
function isEquivalentToAuthority(
	editor: Editor,
	proposal: ReaderSelection,
): boolean {
	const record = getEditorSelectionRecord(editor);
	if (record === null) {
		return false;
	}
	return (
		classifyDomSelectionRead({
			projectionInFlight: false,
			proposal,
			authorityState: toReaderSelection(record.state),
			snapshot: buildLazyNormalPositionSnapshot(editor),
			gestureWindows: CLOSED_GESTURE_WINDOWS,
		}) === "equivalent"
	);
}

export function readNormalizedDomProposal(
	root: HTMLElement,
	editor: Editor,
	selection: Selection | null = root.ownerDocument.getSelection(),
): ReturnType<typeof normalizeSelectionFormation> | null {
	const mapped = domSelectionToEditor(root, selection);
	if (!mapped) {
		return null;
	}
	return normalizeSelectionFormation(editor, mapped);
}

/** What a projection left in the DOM, compared with the record it projected. */
export interface ProjectionReadBack {
	readonly equivalent: boolean;
	readonly focusOnTarget: boolean;
	readonly expected: ReaderSelection;
	readonly actual: ReaderSelection | null;
}

/**
 * Reads the DOM selection back after a projection write and compares it with
 * the authority by the reader's step-3 equivalence, plus focus on the
 * projection target (W3.R1). Null when there is no record to compare.
 */
export function readBackProjection(
	editor: Editor,
	root: HTMLElement,
	target: HTMLElement,
): ProjectionReadBack | null {
	const record = getEditorSelectionRecord(editor);
	if (record === null) {
		return null;
	}
	const expected = toReaderSelection(record.state);
	const actual = readNormalizedDomProposal(root, editor);
	const active = target.ownerDocument.activeElement;
	return {
		equivalent: isLogicallyEquivalent(
			actual,
			expected,
			buildLazyNormalPositionSnapshot(editor),
		),
		focusOnTarget:
			active instanceof Node &&
			(active === target || target.contains(active)),
		expected,
		actual,
	};
}

interface RawNativeRange {
	readonly anchorNode: Node | null;
	readonly anchorOffset: number;
	readonly focusNode: Node | null;
	readonly focusOffset: number;
}

function sameRawRange(
	a: RawNativeRange | null,
	b: RawNativeRange | null,
): boolean {
	if (a === null || b === null) {
		return a === b;
	}
	return (
		a.anchorNode === b.anchorNode &&
		a.anchorOffset === b.anchorOffset &&
		a.focusNode === b.focusNode &&
		a.focusOffset === b.focusOffset
	);
}

/**
 * Maps the live selection inside `root` (S1: the reader owns the live read).
 * Public through `./field-editor/selectionBridge` for hosts.
 */
export function domSelectionToEditor(
	root: HTMLElement,
	sel: Selection | null = root.ownerDocument.getSelection(),
): { anchor: SelectionPoint; focus: SelectionPoint } | null {
	return mapDomSelectionToEditor(root, sel);
}

/**
 * The live range as directional character offsets inside one inline
 * element, or null unless both endpoints are in it. Public through
 * `./field-editor/selectionBridge` for hosts; inside the renderer packages
 * the field editor reads it through `SelectionReader.fieldOffsets` (S1).
 */
export function getDirectionalSelectionOffsets(
	inlineElement: HTMLElement,
	sel: Selection | null = inlineElement.ownerDocument.getSelection(),
): DirectionalSelectionOffsets | null {
	if (!sel || sel.rangeCount === 0) return null;
	if (!sel.anchorNode || !sel.focusNode) return null;
	if (
		!isNodeWithinOrEqual(inlineElement, sel.anchorNode) ||
		!isNodeWithinOrEqual(inlineElement, sel.focusNode)
	) {
		return null;
	}

	const anchor = domPointToOffset(
		inlineElement,
		sel.anchorNode,
		sel.anchorOffset,
	);
	const focus = domPointToOffset(
		inlineElement,
		sel.focusNode,
		sel.focusOffset,
	);

	return {
		anchor,
		focus,
		start: Math.min(anchor, focus),
		end: Math.max(anchor, focus),
	};
}

export function getSelectionOffsets(
	inlineElement: HTMLElement,
): { start: number; end: number } | null {
	const offsets = getDirectionalSelectionOffsets(inlineElement);
	if (!offsets) return null;

	return { start: offsets.start, end: offsets.end };
}

/** The collapsed caret's offset within an inline element, else 0. */
export function getCaretOffset(inlineElement: HTMLElement): number {
	return getSelectionOffsets(inlineElement)?.start ?? 0;
}

function isNodeWithinOrEqual(container: HTMLElement, node: Node): boolean {
	return node === container || container.contains(node);
}

/**
 * The document `Selection` the projector writes through (S1). Only
 * `selectionProjector.ts` calls it; `pen/no-dom-selection-read` flags any
 * other caller, because obtaining it is how a read starts.
 */
export function nativeSelectionForWrite(node: Node): Selection | null {
	return node.ownerDocument?.getSelection() ?? null;
}

/** Test seam for the one `getSelection()` call. */
export interface SelectionReaderDomPort {
	getSelection(doc: Document): Selection | null;
}

const DOCUMENT_SELECTION: SelectionReaderDomPort = {
	getSelection: (doc) => doc.getSelection(),
};

export interface SelectionReaderOptions {
	readonly editor: Editor;
	/** Steps 3–5 on a mapped proposal: equivalent, diverge (P2) or accept. */
	readonly read: (proposal: ReaderSelection) => DomSelectionReadDecision;
	/**
	 * PH1 only: the attached backend's echo restores (CE echo predicates, EC
	 * stale caret and EditContext sync). True when the backend handled the
	 * read. Each is removed in its own engine-gated change (W3.R4).
	 */
	readonly intercept?: (proposal: Exclude<ReaderSelection, null>) => boolean;
	readonly dom?: SelectionReaderDomPort;
	/** After every gesture input, once the windows reflect it. */
	readonly onGesture?: (kind: GestureEventKind) => void;
}

export interface SelectionReader {
	/** Binds the one `selectionchange` listener for `root`. Idempotent per root. */
	attach(root: HTMLElement): void;
	detach(): void;
	/** Runs the R algorithm on the live selection now, as a `selectionchange` would. */
	sync(): DomSelectionReadDecision;
	/** Reader step 2 without deciding; null when no range is inside the root. */
	peek(): ReaderSelection;
	/** Whether the live selection maps inside this root. */
	hasSelectionInRoot(): boolean;
	/**
	 * The live range's directional offsets inside one field element, or null
	 * unless both endpoints are in it. For the reads the authority cannot
	 * answer yet: the caret the browser left after its own edit, before the
	 * diff reaches the model (C2); a field activated with no caret in the
	 * record; and the in-cell caret until it moves into the authority
	 * (W3.R18).
	 */
	fieldOffsets(element: HTMLElement): DirectionalSelectionOffsets | null;
	/** R1–R3 gesture input; the only way window state changes. */
	notifyGesture(kind: GestureEventKind): void;
	readonly windows: GestureWindowState;
	/** Whether a `selectionchange` now would be admissible (any window open). */
	isAdmissibleRead(): boolean;
	/** Closes every window, as a session reset does. */
	resetGestures(): void;
}

/**
 * The authority's text selection inside one block, as directional offsets.
 * Input handlers call `reader.sync()` first and then read this instead of
 * mapping the live selection (W3.R5). Null when the selection is not a text
 * selection with both endpoints in `blockId`.
 */
export function authorityOffsetsInBlock(
	editor: Editor,
	blockId: string,
): { anchor: number; focus: number; start: number; end: number } | null {
	const selection = editor.selection;
	if (
		selection?.type !== "text" ||
		selection.anchor.blockId !== blockId ||
		selection.focus.blockId !== blockId
	) {
		return null;
	}
	const anchor = selection.anchor.offset;
	const focus = selection.focus.offset;
	return {
		anchor,
		focus,
		start: Math.min(anchor, focus),
		end: Math.max(anchor, focus),
	};
}

/**
 * The single reader (S1, W3.R4): one `selectionchange` listener per editor
 * root, bound from `setRootElement` whether or not a field is attached.
 * Backends no longer listen; a read that maps inside the root goes through
 * the reader's equivalence check, the backend's transitional intercept, and
 * then the R decision.
 */
export function createSelectionReader(
	options: SelectionReaderOptions,
): SelectionReader {
	const dom = options.dom ?? DOCUMENT_SELECTION;
	let root: HTMLElement | null = null;
	let windows: GestureWindowState = CLOSED_GESTURE_WINDOWS;
	let pointerSettledBound = false;
	// The raw native range at the press, so pointerup reads only a range the
	// gesture moved; a click on chrome or a cell leaves the old one standing.
	let pressRange: RawNativeRange | null = null;
	const rawRange = (): RawNativeRange | null => {
		const selection = root ? dom.getSelection(root.ownerDocument) : null;
		if (!selection) {
			return null;
		}
		return {
			anchorNode: selection.anchorNode,
			anchorOffset: selection.anchorOffset,
			focusNode: selection.focusNode,
			focusOffset: selection.focusOffset,
		};
	};

	// R1: a pointerup anywhere in the document ends the pointer gesture,
	// which may have started in the content and ended outside it.
	const bindPointerSettled = (): void => {
		if (pointerSettledBound) {
			return;
		}
		const doc = root?.ownerDocument ?? globalThis.document;
		if (typeof doc?.addEventListener !== "function") {
			return;
		}
		pointerSettledBound = true;
		const onUp = (): void => {
			doc.removeEventListener("pointerup", onUp);
			pointerSettledBound = false;
			// The gesture's last native range — a drag's end, or the word or
			// paragraph a multi-click expanded on press — is in the DOM now,
			// but its selectionchange is queued behind pointer-settled. Read
			// it while the window is still open (D19).
			if (!sameRawRange(pressRange, rawRange())) {
				sync();
			}
			pressRange = null;
			notifyGesture("pointerup");
		};
		doc.addEventListener("pointerup", onUp);
	};
	const notifyGesture = (kind: GestureEventKind): void => {
		if (kind === "pointerdown") {
			if (!pointerSettledBound) {
				pressRange = rawRange();
			}
			bindPointerSettled();
		}
		windows = nextGestureWindowState(kind, windows);
		if (kind === "pointerup") {
			// R1: the one microtask on a selection path; it changes window
			// state only, so a click-collapse settles first (S4).
			queueMicrotask(() => {
				windows = nextGestureWindowState("pointer-settled", windows);
			});
		}
		options.onGesture?.(kind);
	};

	const peek = (): ReaderSelection => {
		if (!root) {
			return null;
		}
		return readNormalizedDomProposal(
			root,
			options.editor,
			dom.getSelection(root.ownerDocument),
		);
	};
	const sync = (): DomSelectionReadDecision => {
		const proposal = peek();
		if (proposal === null) {
			return "no-proposal";
		}
		// Step 3 first: an echo of the record changes nothing, and is not
		// offered to the backend's echo restores.
		if (isEquivalentToAuthority(options.editor, proposal)) {
			return "equivalent";
		}
		if (options.intercept?.(proposal)) {
			return "no-proposal";
		}
		return options.read(proposal);
	};
	const onSelectionChange = (): void => {
		sync();
	};
	const detach = (): void => {
		root?.ownerDocument.removeEventListener(
			"selectionchange",
			onSelectionChange,
		);
		root = null;
	};

	return {
		attach(nextRoot) {
			if (root === nextRoot) {
				return;
			}
			detach();
			root = nextRoot;
			nextRoot.ownerDocument.addEventListener(
				"selectionchange",
				onSelectionChange,
			);
		},
		detach,
		sync,
		peek,
		hasSelectionInRoot: () => peek() !== null,
		fieldOffsets: (element) =>
			getDirectionalSelectionOffsets(
				element,
				dom.getSelection(element.ownerDocument),
			),
		notifyGesture,
		get windows() {
			return windows;
		},
		isAdmissibleRead: () => isAdmissibleDomRead("selectionchange", windows),
		resetGestures() {
			windows = CLOSED_GESTURE_WINDOWS;
			pointerSettledBound = false;
		},
	};
}

export function decideDomSelectionRead(input: {
	editor: Editor;
	proposal: ReaderSelection;
	gestureWindows: GestureWindowState;
	projectionInFlight: boolean;
}): {
	decision: DomSelectionReadDecision;
	normalized: ReaderSelection | null;
	origin: GestureSelectionOrigin;
} {
	const record = getEditorSelectionRecord(input.editor);
	const snapshot = buildLazyNormalPositionSnapshot(input.editor);
	const decision = classifyDomSelectionRead({
		projectionInFlight: input.projectionInFlight,
		proposal: input.proposal,
		authorityState:
			record === null ? null : toReaderSelection(record.state),
		snapshot,
		gestureWindows: input.gestureWindows,
	});
	const origin = originForGestureWindows(input.gestureWindows);
	if (decision !== "accept") {
		return { decision, normalized: null, origin };
	}
	const authorityState =
		record === null ? null : toReaderSelection(record.state);
	return {
		decision,
		normalized: normalizeDomSelectionProposal(
			input.proposal,
			snapshot,
			undefined,
			authorityState,
		),
		origin,
	};
}

export function originForGestureWindows(
	state: GestureWindowState,
): GestureSelectionOrigin {
	return state.ime ? "ime" : "pointer";
}

export function normalizeDomSelectionProposal(
	proposal: ReaderSelection,
	snapshot: ReaderSnapshot,
	dir?: 1 | -1,
	authorityState?: ReaderSelection,
): ReaderSelection {
	if (proposal === null) {
		return proposal;
	}
	if (proposal.type === "block") {
		return preserveAuthorityBlockHead(proposal, authorityState ?? null);
	}
	if (proposal.type !== "text") {
		return proposal;
	}
	const snapDir = dir ?? gestureFocusDir(proposal, snapshot);
	return {
		type: "text",
		anchor: snapAcceptedPoint(proposal.anchor, snapshot, snapDir),
		focus: snapAcceptedPoint(proposal.focus, snapshot, snapDir),
	};
}

/**
 * The origin of a paste or drop caret (S3): `pointer` for a drop or while the
 * context-menu or drag window is open (a menu paste, a drag-paste), else
 * `keyboard` (a shortcut paste).
 */
export function originForTransfer(
	source: { getGestureWindows?(): GestureWindowState } | null | undefined,
	isDrop = false,
): "pointer" | "keyboard" {
	const windows = source?.getGestureWindows?.() ?? CLOSED_GESTURE_WINDOWS;
	return isDrop || windows.contextMenu || windows.drag
		? "pointer"
		: "keyboard";
}

export function nextGestureWindowState(
	eventKind: GestureEventKind,
	state: GestureWindowState,
): GestureWindowState {
	switch (eventKind) {
		case "pointerdown":
			return { ...state, pointer: true };
		case "pointerup":
			return state;
		case "pointer-settled":
			return { ...state, pointer: false };
		case "compositionstart":
			return { ...state, ime: true };
		case "compositionend-completed":
			return { ...state, ime: false };
		case "contextmenu":
			return { ...state, contextMenu: true };
		case "selectionchange":
			return { ...state, contextMenu: false };
		case "dragstart":
			return { ...state, drag: true };
		case "drop-completed":
		case "dragend-completed":
			return { ...state, drag: false };
		case "keydown":
		case "keyup":
			return state;
		default: {
			const _exhaustive: never = eventKind;
			return _exhaustive;
		}
	}
}

export function isAdmissibleDomRead(
	eventKind: GestureEventKind,
	state: GestureWindowState,
): boolean {
	if (eventKind !== "selectionchange") {
		return false;
	}
	return state.pointer || state.ime || state.contextMenu || state.drag;
}

function toReaderSelection(state: SelectionRecordState): ReaderSelection {
	if (state === null) {
		return null;
	}
	switch (state.type) {
		case "text":
			return {
				type: "text",
				anchor: state.anchor,
				focus: state.focus,
			};
		case "block":
			return {
				type: "block",
				blockIds: state.blockIds,
				head: state.head,
			};
		case "app":
			return { type: "app", appId: state.appId };
		case "cell":
			return {
				type: "cell",
				blockId: state.blockId,
				anchor: state.anchor,
				head: state.head,
			};
		default: {
			const _exhaustive: never = state;
			return _exhaustive;
		}
	}
}

function sameSnappedPoint(
	domPoint: ReaderPoint,
	authorityPoint: ReaderPoint,
	snapshot: ReaderSnapshot,
): boolean {
	// The same point is equivalent without snapping. A structural block's
	// 0..1 endpoint (N2, T2's cover) has no text to snap in, so only this
	// recognises it.
	if (
		domPoint.blockId === authorityPoint.blockId &&
		domPoint.offset === authorityPoint.offset
	) {
		return true;
	}
	const logicalDom = toLogicalPoint(domPoint, snapshot);
	if (logicalDom === null) {
		return false;
	}
	const authoritySnap = snapToNormalPosition(snapshot, authorityPoint, 1);
	return (
		sameSnapResult(
			snapToNormalPosition(snapshot, logicalDom, 1),
			authoritySnap,
		) ||
		sameSnapResult(
			snapToNormalPosition(snapshot, logicalDom, -1),
			authoritySnap,
		)
	);
}

function sameSnapResult(
	left: ReturnType<typeof snapToNormalPosition>,
	right: ReturnType<typeof snapToNormalPosition>,
): boolean {
	if (left === null || right === null) {
		return false;
	}
	const leftBoundary = "blockBoundary" in left;
	const rightBoundary = "blockBoundary" in right;
	if (leftBoundary || rightBoundary) {
		return (
			leftBoundary &&
			rightBoundary &&
			left.blockBoundary === right.blockBoundary
		);
	}
	return left.blockId === right.blockId && left.offset === right.offset;
}

function toLogicalPoint(
	point: ReaderPoint,
	snapshot: ReaderSnapshot,
): ReaderPoint | null {
	const block = resolveTextBlock(snapshot, point.blockId);
	if (!block) {
		return null;
	}
	return {
		blockId: point.blockId,
		offset: toLogicalOffset(point.offset, block.text),
	};
}

function resolveTextBlock(
	snapshot: ReaderSnapshot,
	blockId: string,
): ReaderBlock | null {
	if (
		!(snapshot.has
			? snapshot.has(blockId)
			: snapshot.blockOrder.includes(blockId))
	) {
		return null;
	}
	const block = snapshot.blocks[blockId];
	if (!block || block.kind === "structural") {
		return null;
	}
	return block;
}

function defaultBlockHead(selection: {
	readonly blockIds: readonly string[];
	readonly head?: string;
}): string {
	return (
		selection.head ??
		selection.blockIds[selection.blockIds.length - 1] ??
		selection.blockIds[0] ??
		""
	);
}

function preserveAuthorityBlockHead(
	proposal: Extract<ReaderSelection, { type: "block" }>,
	authorityState: ReaderSelection,
): Extract<ReaderSelection, { type: "block" }> {
	if (proposal.head) {
		return proposal;
	}
	if (
		authorityState?.type === "block" &&
		sameBlockIds(proposal.blockIds, authorityState.blockIds) &&
		authorityState.head
	) {
		return { ...proposal, head: authorityState.head };
	}
	return proposal;
}

function gestureFocusDir(
	proposal: Extract<ReaderSelection, { type: "text" }>,
	snapshot: ReaderSnapshot,
): 1 | -1 {
	const anchorIndex = snapshot.blockOrder.indexOf(proposal.anchor.blockId);
	const focusIndex = snapshot.blockOrder.indexOf(proposal.focus.blockId);
	if (anchorIndex === focusIndex) {
		return proposal.anchor.offset <= proposal.focus.offset ? 1 : -1;
	}
	return anchorIndex <= focusIndex ? 1 : -1;
}

function snapAcceptedPoint(
	point: ReaderPoint,
	snapshot: ReaderSnapshot,
	dir: 1 | -1,
): ReaderPoint {
	const logical = toLogicalPoint(point, snapshot);
	const snapped = snapToNormalPosition(snapshot, logical ?? point, dir);
	if (snapped === null || "blockBoundary" in snapped) {
		return logical ?? point;
	}
	return snapped;
}

function sameBlockIds(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}
