import type { Editor } from "@input/pen-types";
import { getRootGeometry } from "../geometry/rootGeometry";
import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	createInlineAtomDragPreview,
	type InlineAtomDragPreview,
} from "../utils/inlineAtomDragPreview";
import {
	getInlineAtomAtOffset,
	moveInlineAtom,
	removeInlineAtom,
	resolveInlineAtomDropTarget,
	type InlineAtomDropTarget,
	type InlineAtomRenderInteractionProps,
	type InlineAtomSnapshot,
	type InlineAtomSource,
	type ResolvedInlineAtomInteractions,
} from "./inlineAtomInteraction";
import {
	canDestructure,
	destructureInlineAtom,
	notifyRejected,
	selectInlineAtomRangeFromShiftClick,
} from "./inlineAtomDestructure";
import { isDomDocument, isDomHTMLElement } from "../utils/domNodes";

const DRAG_THRESHOLD_PX = 4;

interface InlineAtomInteractionRootState {
	editor: Editor;
	readonly: boolean;
	interactions: ResolvedInlineAtomInteractions;
}

export interface InlineAtomWrapperInteractionOptions {
	element: HTMLElement;
	editor: Editor;
	blockId: string;
	offset: number;
	type: string;
	text: string;
	props: Record<string, unknown>;
	selected: boolean;
	interactions: ResolvedInlineAtomInteractions;
	readonly: boolean;
}

interface PointerSession {
	source: InlineAtomSource;
	sourceElement: HTMLElement;
	sourceRoot: HTMLElement;
	atom: InlineAtomSnapshot;
	startX: number;
	startY: number;
	latestX: number;
	latestY: number;
	isDragging: boolean;
	frameScheduled: boolean;
	preview: InlineAtomDragPreview | null;
}

export interface InlineAtomDragSnapshot {
	source: InlineAtomSource | null;
	target: InlineAtomDropTarget | null;
	dragging: boolean;
	version: number;
}

const rootRegistry = new Map<HTMLElement, InlineAtomInteractionRootState>();
const documentListenerCounts = new Map<Document, number>();
const documentPointerSessions = new Map<Document, PointerSession>();
const dragListeners = new Set<() => void>();
let dragSnapshot: InlineAtomDragSnapshot = {
	source: null,
	target: null,
	dragging: false,
	version: 0,
};

export function registerInlineAtomInteractionRoot(
	root: HTMLElement,
	state: InlineAtomInteractionRootState,
): () => void {
	attachDocumentListeners(root.ownerDocument);
	rootRegistry.set(root, state);
	return () => {
		const current = rootRegistry.get(root);
		if (current === state) {
			rootRegistry.delete(root);
		}
		detachDocumentListeners(root.ownerDocument);
	};
}

export function attachInlineAtomWrapperInteractions(
	options: InlineAtomWrapperInteractionOptions,
): () => void {
	const handlePointerDown = (event: PointerEvent) => {
		if (event.button === 0 && event.shiftKey && !options.readonly) {
			if (selectInlineAtomRangeFromShiftClick(options)) {
				event.preventDefault();
				event.stopPropagation();
			}
			// Otherwise a cross-block extend, left to the content gestures;
			// a shift press never starts an atom drag.
			return;
		}

		if (
			event.button !== 0 ||
			options.readonly ||
			!options.interactions.drag ||
			documentPointerSessions.has(options.element.ownerDocument)
		) {
			return;
		}

		const atom = getInlineAtomAtOffset(options.editor, {
			blockId: options.blockId,
			offset: options.offset,
		});
		if (!atom) {
			notifyRejected(options, { reason: "stale-source" });
			return;
		}
		const sourceRoot = getRegisteredRootForElement(options.element);
		if (!sourceRoot) {
			notifyRejected(options, { reason: "missing-target" });
			return;
		}

		documentPointerSessions.set(options.element.ownerDocument, {
			source: {
				editor: options.editor,
				blockId: options.blockId,
				offset: options.offset,
			},
			sourceElement: options.element,
			sourceRoot,
			atom,
			startX: event.clientX,
			startY: event.clientY,
			latestX: event.clientX,
			latestY: event.clientY,
			isDragging: false,
			frameScheduled: false,
			preview: null,
		});
		options.element.setPointerCapture?.(event.pointerId);
	};

	const handleDoubleClick = (event: MouseEvent) => {
		if (options.readonly || !canDestructure(options)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		destructureInlineAtom(options, "pointer");
	};

	options.element.addEventListener("pointerdown", handlePointerDown);
	options.element.addEventListener("dblclick", handleDoubleClick);
	return () => {
		options.element.removeEventListener("pointerdown", handlePointerDown);
		options.element.removeEventListener("dblclick", handleDoubleClick);
	};
}

export function getInlineAtomRenderInteractionProps(
	options: InlineAtomWrapperInteractionOptions,
	dragging = false,
): InlineAtomRenderInteractionProps | undefined {
	const canRemove = !options.readonly;
	if (!options.interactions.drag && !canDestructure(options) && !canRemove) {
		return undefined;
	}

	return {
		draggable: options.interactions.drag && !options.readonly,
		dragging,
		canDestructure: canDestructure(options) && !options.readonly,
		canRemove,
		destructure: canDestructure(options)
			? () => destructureInlineAtom(options)
			: undefined,
		remove: canRemove
			? () =>
					removeInlineAtom({
						source: {
							editor: options.editor,
							blockId: options.blockId,
							offset: options.offset,
						},
					})
			: undefined,
	};
}

export function subscribeInlineAtomDragSnapshot(
	listener: () => void,
): () => void {
	dragListeners.add(listener);
	return () => {
		dragListeners.delete(listener);
	};
}

export function getInlineAtomDragSnapshot(): InlineAtomDragSnapshot {
	return dragSnapshot;
}

export { resolveShiftClickInlineAtomSelection } from "./inlineAtomDestructure";

export function isInlineAtomDragSource(
	snapshot: InlineAtomDragSnapshot,
	editor: Editor,
	blockId: string,
	offset: number,
): boolean {
	return (
		snapshot.dragging &&
		snapshot.source?.editor === editor &&
		snapshot.source.blockId === blockId &&
		snapshot.source.offset === offset
	);
}

function handleDocumentPointerMove(event: PointerEvent): void {
	const session = getPointerSessionForEvent(event);
	if (!session) {
		return;
	}

	session.latestX = event.clientX;
	session.latestY = event.clientY;

	const movedDistance = Math.hypot(
		event.clientX - session.startX,
		event.clientY - session.startY,
	);
	if (!session.isDragging && movedDistance < DRAG_THRESHOLD_PX) {
		return;
	}

	event.preventDefault();

	if (!session.isDragging) {
		startInlineAtomDrag(session);
	}

	schedulePointerMoveFrame(session);
}

function handleDocumentPointerUp(event: PointerEvent): void {
	const doc = getEventDocument(event);
	const session = doc ? (documentPointerSessions.get(doc) ?? null) : null;
	if (doc) {
		documentPointerSessions.delete(doc);
	}
	if (!session?.isDragging) {
		cleanupPointerSession(session);
		return;
	}

	event.preventDefault();
	const target = resolveTargetFromPoint(
		session.sourceRoot.ownerDocument,
		event.clientX,
		event.clientY,
	);
	const sourceState = rootRegistry.get(session.sourceRoot);
	cleanupPointerSession(session);
	if (!sourceState) {
		return;
	}

	if (!target) {
		sourceState.interactions.onMoveRejected?.({
			source: session.source,
			atom: session.atom,
			reason: "missing-target",
		});
		return;
	}

	if (
		sourceState.interactions.onBeforeMove?.({
			source: session.source,
			target,
			atom: session.atom,
		}) === false
	) {
		sourceState.interactions.onMoveRejected?.({
			source: session.source,
			target,
			atom: session.atom,
			reason: "policy",
		});
		return;
	}

	const moved = moveInlineAtom({ source: session.source, target });
	if (!moved) {
		sourceState.interactions.onMoveRejected?.({
			source: session.source,
			target,
			atom: session.atom,
			reason: "schema",
		});
		return;
	}

	sourceState.interactions.onMove?.({
		source: session.source,
		target,
		atom: session.atom,
	});
}

function handleDocumentPointerCancel(event: PointerEvent): void {
	const doc = getEventDocument(event);
	const session = doc ? (documentPointerSessions.get(doc) ?? null) : null;
	if (doc) {
		documentPointerSessions.delete(doc);
	}
	cleanupPointerSession(session);
}

function startInlineAtomDrag(session: PointerSession): void {
	session.isDragging = true;
	session.sourceElement.toggleAttribute(DATA_ATTRS.inlineAtomDragging, true);
	session.preview = createInlineAtomDragPreview({
		sourceElement: session.sourceElement,
		clientX: session.latestX,
		clientY: session.latestY,
	});
	setDragSnapshot({
		source: session.source,
		target: null,
		dragging: true,
		version: dragSnapshot.version + 1,
	});
}

function schedulePointerMoveFrame(session: PointerSession): void {
	if (session.frameScheduled) {
		return;
	}

	// One preview move per frame, on the scheduler's write phase instead of
	// its own rAF (FE3). Nothing cancels the job — the guard below already
	// drops it when the session ended before the frame ran.
	session.frameScheduled = true;
	void getRootGeometry(session.sourceRoot).scheduler.write(() => {
		session.frameScheduled = false;
		if (
			documentPointerSessions.get(session.sourceRoot.ownerDocument) !==
				session ||
			!session.isDragging
		) {
			return;
		}

		session.preview?.updatePosition(session.latestX, session.latestY);
		updateInlineAtomDragTarget(
			session,
			resolveTargetFromPoint(
				session.sourceRoot.ownerDocument,
				session.latestX,
				session.latestY,
			),
		);
	});
}

function cleanupPointerSession(session: PointerSession | null): void {
	if (!session) {
		return;
	}

	session.frameScheduled = false;
	session.preview?.destroy();
	session.preview = null;
	session.sourceElement.toggleAttribute(DATA_ATTRS.inlineAtomDragging, false);

	if (dragSnapshot.dragging && dragSnapshot.source === session.source) {
		setDragSnapshot({
			source: null,
			target: null,
			dragging: false,
			version: dragSnapshot.version + 1,
		});
	}
}

function updateInlineAtomDragTarget(
	session: PointerSession,
	target: InlineAtomDropTarget | null,
): void {
	if (!dragSnapshot.dragging || dragSnapshot.source !== session.source) {
		return;
	}
	if (areInlineAtomDropTargetsEqual(dragSnapshot.target, target)) {
		return;
	}

	setDragSnapshot({
		...dragSnapshot,
		target,
		version: dragSnapshot.version + 1,
	});
}

function areInlineAtomDropTargetsEqual(
	left: InlineAtomDropTarget | null,
	right: InlineAtomDropTarget | null,
): boolean {
	return (
		left?.editor === right?.editor &&
		left?.blockId === right?.blockId &&
		left?.offset === right?.offset
	);
}

function setDragSnapshot(nextSnapshot: InlineAtomDragSnapshot): void {
	dragSnapshot = nextSnapshot;
	dragListeners.forEach((listener) => listener());
}

function resolveTargetFromPoint(
	doc: Document,
	clientX: number,
	clientY: number,
): InlineAtomDropTarget | null {
	const element = doc.elementFromPoint(clientX, clientY);
	const root = isDomHTMLElement(element)
		? element.closest<HTMLElement>(`[${DATA_ATTRS.editorRoot}]`)
		: null;
	if (!root) {
		return null;
	}

	const state = rootRegistry.get(root);
	if (!state || state.readonly || !state.interactions.drag) {
		return null;
	}

	return resolveInlineAtomDropTarget({
		editor: state.editor,
		root,
		clientX,
		clientY,
	});
}

function getRegisteredRootForElement(element: HTMLElement): HTMLElement | null {
	return element.closest<HTMLElement>(`[${DATA_ATTRS.editorRoot}]`);
}

function attachDocumentListeners(doc: Document): void {
	const count = documentListenerCounts.get(doc) ?? 0;
	if (count > 0) {
		documentListenerCounts.set(doc, count + 1);
		return;
	}
	doc.addEventListener("pointermove", handleDocumentPointerMove, true);
	doc.addEventListener("pointerup", handleDocumentPointerUp, true);
	doc.addEventListener("pointercancel", handleDocumentPointerCancel, true);
	documentListenerCounts.set(doc, 1);
}

function detachDocumentListeners(doc: Document): void {
	const count = documentListenerCounts.get(doc) ?? 0;
	if (count > 1) {
		documentListenerCounts.set(doc, count - 1);
		return;
	}
	if (count === 0) {
		return;
	}
	doc.removeEventListener("pointermove", handleDocumentPointerMove, true);
	doc.removeEventListener("pointerup", handleDocumentPointerUp, true);
	doc.removeEventListener("pointercancel", handleDocumentPointerCancel, true);
	const session = documentPointerSessions.get(doc) ?? null;
	documentPointerSessions.delete(doc);
	cleanupPointerSession(session);
	documentListenerCounts.delete(doc);
}

function getPointerSessionForEvent(event: PointerEvent): PointerSession | null {
	const doc = getEventDocument(event);
	return doc ? (documentPointerSessions.get(doc) ?? null) : null;
}

function getEventDocument(event: Event): Document | null {
	const currentTarget = event.currentTarget;
	return isDomDocument(currentTarget) ? currentTarget : null;
}
