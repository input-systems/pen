import {
	isContainerBlockType,
	resolveBlockDirection,
	shouldRenderContainerChildren,
	usesInlineTextSelection,
} from "@input/pen-core";
import type { BlockHandle, Editor } from "@input/pen-types";
import type { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { fullReconcileDeltasToDOM } from "../field-editor/reconciler";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import { buildDataAttributes, DATA_ATTRS } from "../utils/dataAttributes";
import { resolveBlockTextAlignment } from "../utils/blockTextAlignment";
import { getChildBlockIds, getRootBlockIds } from "../utils/parentIdTree";

export interface DocumentTree {
	readonly content: HTMLElement;
	readonly blocksHost: HTMLElement;
	sync(): void;
}

interface BlockNodes {
	element: HTMLElement;
	inline: HTMLElement | null;
	childrenHost: HTMLElement | null;
}

export function createDocumentTree(
	editor: Editor,
	fieldEditor: FieldEditorImpl,
	parent: HTMLElement,
): DocumentTree {
	const content = parent.ownerDocument.createElement("div");
	content.setAttribute(DATA_ATTRS.editorContent, "");
	const blocksHost = parent.ownerDocument.createElement("div");
	blocksHost.setAttribute(DATA_ATTRS.editorBlocksHost, "");
	content.append(blocksHost);
	parent.append(content);

	const nodesByBlockId = new Map<string, BlockNodes>();
	const ownerDocument = parent.ownerDocument;

	const sync = (): void => {
		const seen = new Set<string>();
		syncBlockList(
			editor,
			fieldEditor,
			blocksHost,
			getRootBlockIds(editor),
			nodesByBlockId,
			ownerDocument,
			seen,
		);
		for (const [blockId, nodes] of nodesByBlockId) {
			if (seen.has(blockId)) {
				continue;
			}
			nodes.element.remove();
			nodesByBlockId.delete(blockId);
		}
	};

	sync();

	return { content, blocksHost, sync };
}

function syncBlockList(
	editor: Editor,
	fieldEditor: FieldEditorImpl,
	host: HTMLElement,
	blockIds: readonly string[],
	nodesByBlockId: Map<string, BlockNodes>,
	ownerDocument: Document,
	seen: Set<string>,
): void {
	for (const blockId of blockIds) {
		seen.add(blockId);
		const nodes =
			nodesByBlockId.get(blockId) ??
			createBlockNodes(editor, blockId, ownerDocument);
		nodesByBlockId.set(blockId, nodes);
		updateBlockNodes(editor, fieldEditor, nodes, blockId);
		if (nodes.element.parentElement !== host) {
			host.append(nodes.element);
		}
		if (nodes.childrenHost) {
			syncBlockList(
				editor,
				fieldEditor,
				nodes.childrenHost,
				visibleChildBlockIds(editor, blockId),
				nodesByBlockId,
				ownerDocument,
				seen,
			);
		}
	}

	reorderChildren(host, blockIds, nodesByBlockId);
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

	const body = ownerDocument.createElement("div");
	element.append(body);

	const schema = block ? editor.schema.resolve(block.type) : null;
	const inline = usesInlineTextSelection(schema)
		? ownerDocument.createElement("span")
		: null;
	if (inline) {
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		inline.setAttribute(DATA_ATTRS.fieldEditorSurface, "");
		body.append(inline);
	}

	const childrenHost =
		block && isContainerBlockType(editor, block.type)
			? ownerDocument.createElement("div")
			: null;
	if (childrenHost) {
		element.append(childrenHost);
	}

	return { element, inline, childrenHost };
}

function updateBlockNodes(
	editor: Editor,
	fieldEditor: FieldEditorImpl,
	nodes: BlockNodes,
	blockId: string,
): void {
	const block = editor.getBlock(blockId);
	if (!block) {
		return;
	}

	nodes.element.setAttribute(DATA_ATTRS.blockType, block.type);
	const body = nodes.element.firstElementChild;
	if (body instanceof HTMLElement) {
		body.setAttribute(DATA_ATTRS.blockType, block.type);
	}

	const direction = resolvedContentDir(editor, block);
	if (direction) {
		nodes.element.setAttribute("dir", direction);
	} else {
		nodes.element.removeAttribute("dir");
	}
	nodes.element.style.unicodeBidi = "isolate";
	nodes.element.style.textAlign = resolveBlockTextAlignment(block) ?? "";
	if (nodes.inline) {
		nodes.inline.style.unicodeBidi = "isolate";
		// RI5: stored newlines and repeated spaces are document characters; under
		// the initial `normal` they collapse and become unreachable.
		nodes.inline.style.whiteSpace = "pre-wrap";
	}

	const snapshot = fieldEditor.getSnapshot();
	const isFocused = snapshot.focusBlockId === blockId;
	setBooleanAttr(nodes.element, DATA_ATTRS.focused, isFocused);
	if (nodes.inline) {
		setBooleanAttr(
			nodes.inline,
			DATA_ATTRS.fieldEditorActiveSurface,
			isFocused && snapshot.mode !== "expanded" && snapshot.isEditing,
		);
	}

	if (!nodes.inline || isFieldEditorOwned(snapshot, blockId)) {
		return;
	}

	fullReconcileDeltasToDOM(
		[...block.textDeltas()],
		nodes.inline,
		editor.schema,
		{
			preserveSelection: false,
			urlPolicy: urlPolicyFromEditor(editor),
		},
	);
}

function visibleChildBlockIds(
	editor: Editor,
	parentBlockId: string,
): readonly string[] {
	if (
		!shouldRenderContainerChildren(editor, editor.getBlock(parentBlockId))
	) {
		return [];
	}
	return getChildBlockIds(editor, parentBlockId);
}

function isFieldEditorOwned(
	snapshot: ReturnType<FieldEditorImpl["getSnapshot"]>,
	blockId: string,
): boolean {
	if (
		snapshot.mode === "expanded" &&
		snapshot.activeBlockIds.includes(blockId)
	) {
		return true;
	}
	return snapshot.isEditing && snapshot.focusBlockId === blockId;
}

function reorderChildren(
	host: HTMLElement,
	blockIds: readonly string[],
	nodesByBlockId: Map<string, BlockNodes>,
): void {
	for (let index = 0; index < blockIds.length; index += 1) {
		const nodes = nodesByBlockId.get(blockIds[index]);
		if (!nodes) {
			continue;
		}
		const current = host.children[index];
		if (current !== nodes.element) {
			host.insertBefore(nodes.element, current ?? null);
		}
	}
}

function setBooleanAttr(
	element: HTMLElement,
	name: string,
	value: boolean,
): void {
	const next = buildDataAttributes({ [name]: value })[name];
	if (next === undefined) {
		element.removeAttribute(name);
	} else {
		element.setAttribute(name, next);
	}
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
