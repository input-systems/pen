import {
	isContainerBlockType,
	resolveBlockDirection,
	shouldRenderContainerChildren,
	usesInlineTextSelection,
	type ListItemSemantics,
	type ListSegment,
} from "@input/pen-core";
import type { BlockHandle, Editor, Unsubscribe } from "@input/pen-types";
import { createListSemanticsStore } from "../a11y/listSemantics";
import type { BlockSnapshot } from "../field-editor/blockNotifierTypes";
import type { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { fullReconcileDeltasToDOM } from "../field-editor/reconciler";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import {
	buildDataAttributes,
	DATA_ATTRS,
	LIST_GROUP_ATTRIBUTES,
	listItemHostAttributes,
} from "../utils/dataAttributes";
import { resolveBlockTextAlignment } from "../utils/blockTextAlignment";
import { isDomHTMLElement } from "../utils/domNodes";
import { fieldEditorTextEntryAttrs } from "../utils/fieldEditorTextEntryAttrs";

export interface DocumentTree {
	readonly content: HTMLElement;
	readonly blocksHost: HTMLElement;
	/** Full walk: mount, and a fallback. Commits update only the blocks the notifier names. */
	sync(): void;
	/** Drops the tree's notifier subscriptions. */
	destroy(): void;
}

/** One rendered sibling list: its host element, its list group wrappers, and what it last rendered. */
interface SiblingHost {
	readonly element: HTMLElement;
	/** AX1 group wrappers by segment key. */
	readonly groups: Map<string, HTMLElement>;
	segments: readonly ListSegment[];
}

interface BlockNodes {
	element: HTMLElement;
	inline: HTMLElement | null;
	children: SiblingHost | null;
	/** The block revision the inline content was last reconciled at; -1 forces one. */
	reconciledRevision: number;
	unsubscribe: Unsubscribe;
}

const NO_SEGMENTS: readonly ListSegment[] = Object.freeze([]);

/**
 * The vanilla `mountEditor` document tree (SCALE6). Each block node listens
 * to its own block in the field editor's notifier and updates only itself;
 * a parent re-syncs its own child list when its list segments change, and
 * the root list re-syncs when the root segments change. Each run of list
 * items renders inside a `div[data-pen-list-group][role="list"]` (AX1).
 * Attributes and styles are written only when they differ, inline content is
 * reconciled only when the block's revision moved, and a reorder moves only
 * the nodes out of place, never recreating them.
 */
export function createDocumentTree(
	editor: Editor,
	fieldEditor: FieldEditorImpl,
	parent: HTMLElement,
): DocumentTree {
	const ownerDocument = parent.ownerDocument;
	const content = ownerDocument.createElement("div");
	content.setAttribute(DATA_ATTRS.editorContent, "");
	const blocksHost = ownerDocument.createElement("div");
	blocksHost.setAttribute(DATA_ATTRS.editorBlocksHost, "");
	content.append(blocksHost);
	parent.append(content);

	const notifier = fieldEditor.blockNotifier;
	const listSemantics = createListSemanticsStore(notifier);
	const nodesByBlockId = new Map<string, BlockNodes>();
	const root: SiblingHost = { element: blocksHost, groups: new Map(), segments: NO_SEGMENTS };
	let syncDepth = 0;
	const pendingAcks: string[] = [];
	/** The element that held focus in the tree when the outermost list sync began. */
	let focusBeforeSync: HTMLElement | null = null;

	const destroyNodes = (blockId: string): void => {
		const nodes = nodesByBlockId.get(blockId);
		if (!nodes) return;
		nodesByBlockId.delete(blockId);
		nodes.unsubscribe();
		nodes.element.remove();
		for (const childId of segmentBlockIds(nodes.children?.segments ?? NO_SEGMENTS)) {
			destroyNodes(childId);
		}
	};

	const syncList = (host: SiblingHost, segments: readonly ListSegment[]): void => {
		const previous = host.segments;
		host.segments = segments;
		const blockIds = segmentBlockIds(segments);
		const next = new Set(blockIds);
		for (const blockId of segmentBlockIds(previous)) {
			if (!next.has(blockId)) destroyNodes(blockId);
		}
		if (syncDepth === 0) focusBeforeSync = focusedElementIn(content);
		syncDepth += 1;
		for (const blockId of blockIds) {
			if (!nodesByBlockId.has(blockId)) {
				mountNodes(blockId);
				pendingAcks.push(blockId);
			}
		}
		reorderSegments(host, segments, nodesByBlockId, ownerDocument);
		syncDepth -= 1;
		if (syncDepth === 0) flushAcks();
	};

	// P4 (W3.R8): a new element is acked in this turn, once the outermost
	// list sync has put it (and any parent mounted with it) in the document.
	// A move into another list group wrapper blurs the moved element, so a
	// move that dropped focus held in the tree is acked too.
	const flushAcks = (): void => {
		const blockIds = pendingAcks.splice(0);
		for (const blockId of blockIds) {
			const element = nodesByBlockId.get(blockId)?.element;
			if (element?.isConnected)
				fieldEditor.ackBlockMounted(blockId, element);
		}
		const focused = focusBeforeSync;
		focusBeforeSync = null;
		if (focused?.isConnected && ownerDocument.activeElement !== focused) {
			fieldEditor.ackBlockMoved(focused);
		}
	};

	const updateBlock = (blockId: string): void => {
		const nodes = nodesByBlockId.get(blockId);
		const block = editor.getBlock(blockId);
		if (!nodes || !block) return;
		updateBlockNodes(editor, nodes, block, notifier.getBlockSnapshot(blockId));
		writeListItemAttributes(nodes.element, listSemantics.getItem(blockId));
		if (nodes.children) {
			const segments = shouldRenderContainerChildren(editor, block)
				? listSemantics.getSegments(blockId)
				: NO_SEGMENTS;
			if (segments !== nodes.children.segments) syncList(nodes.children, segments);
		}
	};

	const mountNodes = (blockId: string): void => {
		const nodes = createBlockNodes(editor, blockId, ownerDocument);
		nodesByBlockId.set(blockId, nodes);
		const update = () => updateBlock(blockId);
		const unsubscribeBlock = notifier.subscribeBlock(blockId, update);
		// A container also hears its own sibling list's segments: a child's list
		// type can change without its child ids changing.
		const unsubscribeSegments = nodes.children
			? notifier.subscribeListSegments(blockId, update)
			: null;
		nodes.unsubscribe = () => {
			unsubscribeBlock();
			unsubscribeSegments?.();
		};
		updateBlock(blockId);
	};

	const syncRoots = (): void => {
		const segments = listSemantics.getSegments(null);
		if (segments !== root.segments) syncList(root, segments);
	};

	const sync = (): void => {
		root.segments = NO_SEGMENTS;
		for (const blockId of [...nodesByBlockId.keys()]) destroyNodes(blockId);
		syncRoots();
	};

	// Root ids change only on structural commits, which also refresh the root
	// segments, so the segment channel alone keeps the root list current.
	const unsubscribeRoot = notifier.subscribeListSegments(null, syncRoots);
	syncRoots();

	// While expanded, the blocks host is this editor's field surface, as the
	// React and Vue hosts mark it; unmarked, HOST9 would read focus on it as a
	// foreign text control's.
	const syncBlocksHostSurface = (): void => {
		writeBlocksHostSurface(
			editor,
			blocksHost,
			notifier.getSurfaceSnapshot().mode === "expanded",
		);
	};
	const unsubscribeSurface = notifier.subscribeSurface(syncBlocksHostSurface);
	syncBlocksHostSurface();

	return {
		content,
		blocksHost,
		sync,
		destroy() {
			unsubscribeSurface();
			unsubscribeRoot();
			for (const nodes of nodesByBlockId.values()) nodes.unsubscribe();
			nodesByBlockId.clear();
			listSemantics.dispose();
		},
	};
}

function createBlockNodes(
	editor: Editor,
	blockId: string,
	ownerDocument: Document,
): BlockNodes {
	const block = editor.getBlock(blockId);
	const element = ownerDocument.createElement("div");
	element.setAttribute(DATA_ATTRS.editorBlock, "");
	element.setAttribute(DATA_ATTRS.blockId, blockId);
	element.tabIndex = -1;
	// RI1: unicode-bidi does not inherit; each block isolates its own run.
	element.style.unicodeBidi = "isolate";

	const body = ownerDocument.createElement("div");
	element.append(body);

	const schema = block ? editor.schema.resolve(block.type) : null;
	const inline = usesInlineTextSelection(schema)
		? ownerDocument.createElement("span")
		: null;
	if (inline) {
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		inline.setAttribute(DATA_ATTRS.fieldEditorSurface, "");
		inline.style.unicodeBidi = "isolate";
		// RI5: stored newlines and repeated spaces are document characters; under
		// the initial `normal` they collapse and become unreachable.
		inline.style.whiteSpace = "pre-wrap";
		body.append(inline);
	}

	const childrenHost =
		block && isContainerBlockType(editor, block.type)
			? ownerDocument.createElement("div")
			: null;
	if (childrenHost) {
		element.append(childrenHost);
	}

	return {
		element,
		inline,
		children: childrenHost
			? { element: childrenHost, groups: new Map(), segments: NO_SEGMENTS }
			: null,
		reconciledRevision: -1,
		unsubscribe: () => {},
	};
}

/** AX1: the list-item role and position on the block host; removed when the block leaves a list. */
function writeListItemAttributes(
	element: HTMLElement,
	item: ListItemSemantics | null,
): void {
	const attributes = listItemHostAttributes(item);
	for (const name of LIST_ITEM_ATTRIBUTE_NAMES) {
		setAttr(element, name, attributes?.[name] ?? null);
	}
}

const LIST_ITEM_ATTRIBUTE_NAMES = [
	"role",
	"aria-level",
	"aria-posinset",
	"aria-setsize",
] as const;

function updateBlockNodes(
	editor: Editor,
	nodes: BlockNodes,
	block: BlockHandle,
	snapshot: BlockSnapshot,
): void {
	setAttr(nodes.element, DATA_ATTRS.blockType, block.type);
	const body = nodes.element.firstElementChild;
	if (isDomHTMLElement(body)) {
		setAttr(body, DATA_ATTRS.blockType, block.type);
	}
	setAttr(nodes.element, "dir", resolvedContentDir(editor, block) ?? null);
	setStyle(
		nodes.element,
		"textAlign",
		resolveBlockTextAlignment(block) ?? "",
	);

	const { field } = snapshot;
	setBooleanAttr(nodes.element, DATA_ATTRS.focused, field.isFieldFocus);
	if (!nodes.inline) return;
	setBooleanAttr(
		nodes.inline,
		DATA_ATTRS.fieldEditorActiveSurface,
		field.isEditing && field.expandedRole === null,
	);
	reconcileInline(editor, nodes, block, snapshot);
}

/**
 * Reconciles inline content when the revision moved since the last reconcile,
 * or when the field editor just released a block it owned (its DOM may hold
 * the backend's edits). An owned block is the field editor's to write.
 */
function reconcileInline(
	editor: Editor,
	nodes: BlockNodes,
	block: BlockHandle,
	snapshot: BlockSnapshot,
): void {
	const inline = nodes.inline;
	if (!inline) return;
	if (isFieldEditorOwned(snapshot)) {
		nodes.reconciledRevision = -1;
		return;
	}
	const revision = snapshot.commit.revision;
	if (revision === nodes.reconciledRevision) return;
	nodes.reconciledRevision = revision;
	// `inlineDeltas` keeps inline atoms; `textDeltas` maps them to "", which
	// rendered an inactive block's mentions and inline apps as nothing.
	const deltas = block.inlineDeltas().map((delta) =>
		typeof delta.insert === "string"
			? { ...delta, insert: delta.insert }
			: { ...delta, insert: { type: delta.insert.type, props: delta.insert.props } },
	);
	fullReconcileDeltasToDOM(deltas, inline, editor.schema, {
		urlPolicy: urlPolicyFromEditor(editor),
	});
}

function isFieldEditorOwned(snapshot: BlockSnapshot): boolean {
	return snapshot.field.expandedRole !== null || snapshot.field.isEditing;
}

/** The focused element when it is inside `container`, else null. */
function focusedElementIn(container: HTMLElement): HTMLElement | null {
	const active = container.ownerDocument.activeElement;
	return isDomHTMLElement(active) && container.contains(active) ? active : null;
}

function segmentBlockIds(segments: readonly ListSegment[]): string[] {
	const blockIds: string[] = [];
	for (const segment of segments) {
		if (segment.kind === "block") blockIds.push(segment.blockId);
		else blockIds.push(...segment.blockIds);
	}
	return blockIds;
}

/**
 * Puts a sibling list's segment elements (group wrappers and block elements)
 * in segment order, then each group's block elements in group order. A
 * wrapper is reused by its key; nodes move, they are never recreated, and
 * only nodes out of place are moved. Wrappers no segment names are removed.
 */
function reorderSegments(
	host: SiblingHost,
	segments: readonly ListSegment[],
	nodesByBlockId: Map<string, BlockNodes>,
	ownerDocument: Document,
): void {
	const liveGroups = new Set<string>();
	const elements: HTMLElement[] = [];
	for (const segment of segments) {
		if (segment.kind === "block") {
			const nodes = nodesByBlockId.get(segment.blockId);
			if (nodes) elements.push(nodes.element);
			continue;
		}
		liveGroups.add(segment.key);
		let group = host.groups.get(segment.key);
		if (!group) {
			group = ownerDocument.createElement("div");
			for (const [name, value] of Object.entries(LIST_GROUP_ATTRIBUTES)) {
				group.setAttribute(name, value);
			}
			host.groups.set(segment.key, group);
		}
		elements.push(group);
		placeInOrder(
			group,
			segment.blockIds.flatMap((blockId) => {
				const element = nodesByBlockId.get(blockId)?.element;
				return element ? [element] : [];
			}),
		);
	}
	placeInOrder(host.element, elements);
	for (const [key, group] of host.groups) {
		if (liveGroups.has(key)) continue;
		host.groups.delete(key);
		group.remove();
	}
}

/** One forward walk over `parent`'s element children; only nodes out of place are moved. */
function placeInOrder(parent: HTMLElement, elements: readonly HTMLElement[]): void {
	let index = 0;
	for (const element of elements) {
		const current = parent.children[index];
		if (current !== element) parent.insertBefore(element, current ?? null);
		index += 1;
	}
}

function writeBlocksHostSurface(
	editor: Editor,
	blocksHost: HTMLElement,
	expanded: boolean,
): void {
	setBooleanAttr(blocksHost, DATA_ATTRS.fieldEditorSurface, expanded);
	for (const [name, value] of Object.entries(
		fieldEditorTextEntryAttrs(expanded, editor),
	)) {
		setAttr(blocksHost, name, value == null ? null : String(value));
	}
}

/** Writes only when the value differs; null removes. */
function setAttr(
	element: HTMLElement,
	name: string,
	value: string | null,
): void {
	if (element.getAttribute(name) === value) return;
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}

function setStyle(
	element: HTMLElement,
	property: "textAlign",
	value: string,
): void {
	if (element.style[property] !== value) element.style[property] = value;
}

function setBooleanAttr(
	element: HTMLElement,
	name: string,
	value: boolean,
): void {
	setAttr(
		element,
		name,
		buildDataAttributes({ [name]: value })[name] ?? null,
	);
}

function resolvedContentDir(
	editor: Editor,
	block: BlockHandle,
): "ltr" | "rtl" | undefined {
	const resolved = resolveBlockDirection(editor, block);
	if (block.props.direction === "ltr" || block.props.direction === "rtl") {
		return resolved;
	}
	return resolved === "rtl" ? "rtl" : undefined;
}
