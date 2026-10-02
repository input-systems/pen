import {
	buildLazyNormalPositionSnapshot,
	getEditorSelectionRecord,
	snapToNormalPosition,
} from "@input/pen-core";
import type { Editor, Point, SelectionRecordState } from "@input/pen-types";
import { toLogicalOffset } from "./offsetDomain";
import { domSelectionToEditor } from "./selectionBridge";
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
	| "ignore-inflight"
	| "no-proposal"
	| "equivalent"
	| "diverge"
	| "accept";

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

export function shouldStopEquivalentDomRead(
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

/**
 * §4.2 step 2. Backends pick the root (editor root vs expanded host);
 * the reader owns the map + formation normalize.
 */
export function resolveEditorRoot(element: HTMLElement): HTMLElement | null {
	return element.closest("[data-pen-editor-root]") as HTMLElement | null;
}

export function readNormalizedDomProposal(
	root: HTMLElement,
	editor: Editor,
): ReturnType<typeof normalizeSelectionFormation> | null {
	const selection = domSelectionToEditor(root);
	if (!selection) {
		return null;
	}
	return normalizeSelectionFormation(editor, selection);
}

export function forwardDomSelectionToReader(
	fieldEditor: {
		readDomSelection?: (proposal: ReaderSelection) => unknown;
	},
	proposal: ReaderSelection,
): boolean {
	if (!fieldEditor.readDomSelection || proposal === null) {
		return false;
	}
	if (proposal.type === "block") {
		fieldEditor.readDomSelection({
			type: "block",
			blockIds: proposal.blockIds,
		});
		return true;
	}
	if (proposal.type !== "text") {
		return false;
	}
	fieldEditor.readDomSelection({
		type: "text",
		anchor: proposal.anchor,
		focus: proposal.focus,
	});
	return true;
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
	if (!(snapshot.has ? snapshot.has(blockId) : snapshot.blockOrder.includes(blockId))) {
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
