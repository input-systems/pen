import {
	isContainerBlockType,
	resolveBlockDirection,
	shouldRenderContainerChildren,
	usesInlineTextSelection,
} from "@input/pen-core";
import type { BlockHandle, Editor, Unsubscribe } from "@input/pen-types";
import type { BlockSnapshot } from "../field-editor/blockNotifierTypes";
import type { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { fullReconcileDeltasToDOM } from "../field-editor/reconciler";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import { buildDataAttributes, DATA_ATTRS } from "../utils/dataAttributes";
import { resolveBlockTextAlignment } from "../utils/blockTextAlignment";

export interface DocumentTree {
	readonly content: HTMLElement;
	readonly blocksHost: HTMLElement;
	/** Full walk: mount, and a fallback. Commits update only the blocks the notifier names. */
	sync(): void;
	/** Drops the tree's notifier subscriptions. */
	destroy(): void;
}

interface BlockNodes {
	element: HTMLElement;
	inline: HTMLElement | null;
	childrenHost: HTMLElement | null;
	/** The child ids last rendered into `childrenHost`. */
	renderedChildIds: readonly string[];
	/** The block revision the inline content was last reconciled at; -1 forces one. */
	reconciledRevision: number;
	unsubscribe: Unsubscribe;
}

const NO_CHILD_IDS: readonly string[] = Object.freeze([]);

/**
 * The vanilla `mountEditor` document tree (SCALE6). Each block node listens
 * to its own block in the field editor's notifier and updates only itself;
 * a parent re-syncs its own child list when its children change, and the
 * root list re-syncs when the root ids change. Attributes and styles are
 * written only when they differ, inline content is reconciled only when the
 * block's revision moved, and a reorder moves only the nodes out of place.
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
	const nodesByBlockId = new Map<string, BlockNodes>();
	let renderedRootIds: readonly string[] = NO_CHILD_IDS;

	const destroyNodes = (blockId: string): void => {
		const nodes = nodesByBlockId.get(blockId);
		if (!nodes) return;
		nodesByBlockId.delete(blockId);
		nodes.unsubscribe();
		nodes.element.remove();
		for (const childId of nodes.renderedChildIds) destroyNodes(childId);
	};

	const syncList = (
		host: HTMLElement,
		blockIds: readonly string[],
		previous: readonly string[],
	): void => {
		const next = new Set(blockIds);
		for (const blockId of previous) {
			if (!next.has(blockId)) destroyNodes(blockId);
		}
		for (const blockId of blockIds) {
			if (!nodesByBlockId.has(blockId)) mountNodes(blockId);
		}
		reorderChildren(host, blockIds, nodesByBlockId);
	};

	const updateBlock = (blockId: string): void => {
		const nodes = nodesByBlockId.get(blockId);
		const block = editor.getBlock(blockId);
		if (!nodes || !block) return;
		const snapshot = notifier.getBlockSnapshot(blockId);
		updateBlockNodes(editor, nodes, block, snapshot);
		if (nodes.childrenHost) {
			const childIds = visibleChildBlockIds(editor, block, snapshot);
			if (!sameIds(childIds, nodes.renderedChildIds)) {
				const previous = nodes.renderedChildIds;
				nodes.renderedChildIds = childIds;
				syncList(nodes.childrenHost, childIds, previous);
			}
		}
	};

	const mountNodes = (blockId: string): void => {
		const nodes = createBlockNodes(editor, blockId, ownerDocument);
		nodesByBlockId.set(blockId, nodes);
		nodes.unsubscribe = notifier.subscribeBlock(blockId, () => updateBlock(blockId));
		updateBlock(blockId);
	};

	const syncRoots = (): void => {
		const rootIds = notifier.getDocumentSnapshot().rootIds;
		if (rootIds === renderedRootIds) return;
		const previous = renderedRootIds;
		renderedRootIds = rootIds;
		syncList(blocksHost, rootIds, previous);
	};

	const sync = (): void => {
		renderedRootIds = NO_CHILD_IDS;
		for (const blockId of [...nodesByBlockId.keys()]) destroyNodes(blockId);
		syncRoots();
	};

	const unsubscribeDocument = notifier.subscribeDocument(syncRoots);
	syncRoots();

	return {
		content,
		blocksHost,
		sync,
		destroy() {
			unsubscribeDocument();
			for (const nodes of nodesByBlockId.values()) nodes.unsubscribe();
			nodesByBlockId.clear();
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
		childrenHost,
		renderedChildIds: NO_CHILD_IDS,
		reconciledRevision: -1,
		unsubscribe: () => {},
	};
}

function updateBlockNodes(
	editor: Editor,
	nodes: BlockNodes,
	block: BlockHandle,
	snapshot: BlockSnapshot,
): void {
	setAttr(nodes.element, DATA_ATTRS.blockType, block.type);
	const body = nodes.element.firstElementChild;
	if (body instanceof HTMLElement) {
		setAttr(body, DATA_ATTRS.blockType, block.type);
	}
	setAttr(nodes.element, "dir", resolvedContentDir(editor, block) ?? null);
	setStyle(nodes.element, "textAlign", resolveBlockTextAlignment(block) ?? "");

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
	fullReconcileDeltasToDOM([...block.textDeltas()], inline, editor.schema, {
		urlPolicy: urlPolicyFromEditor(editor),
	});
}

function visibleChildBlockIds(
	editor: Editor,
	block: BlockHandle,
	snapshot: BlockSnapshot,
): readonly string[] {
	return shouldRenderContainerChildren(editor, block) ? snapshot.childIds : NO_CHILD_IDS;
}

function isFieldEditorOwned(snapshot: BlockSnapshot): boolean {
	return snapshot.field.expandedRole !== null || snapshot.field.isEditing;
}

/** One forward walk; only nodes out of place are moved. */
function reorderChildren(
	host: HTMLElement,
	blockIds: readonly string[],
	nodesByBlockId: Map<string, BlockNodes>,
): void {
	let index = 0;
	for (const blockId of blockIds) {
		const nodes = nodesByBlockId.get(blockId);
		if (!nodes) continue;
		const current = host.children[index];
		if (current !== nodes.element) {
			host.insertBefore(nodes.element, current ?? null);
		}
		index += 1;
	}
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left === right || (left.length === right.length && left.every((id, index) => id === right[index]));
}

/** Writes only when the value differs; null removes. */
function setAttr(element: HTMLElement, name: string, value: string | null): void {
	if (element.getAttribute(name) === value) return;
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}

function setStyle(element: HTMLElement, property: "textAlign", value: string): void {
	if (element.style[property] !== value) element.style[property] = value;
}

function setBooleanAttr(element: HTMLElement, name: string, value: boolean): void {
	setAttr(element, name, buildDataAttributes({ [name]: value })[name] ?? null);
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
