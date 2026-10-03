const PEN_PREFIX = "data-pen-";

export function penDataAttr(name: string): string {
	return `${PEN_PREFIX}${name}`;
}

/**
 * Boolean values are presence-only: `true` becomes `""`, `false`/`undefined` are omitted.
 * Keys that already start with `data-` pass through unchanged — pass `DATA_ATTRS`
 * values at production sites so the emitted name stays coupled to the catalog.
 */
export function buildDataAttributes(
	attrs: Record<string, string | number | boolean | undefined>,
): Record<string, string | undefined> {
	const result: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === false) continue;
		const name = key.startsWith("data-") ? key : `data-${key}`;
		result[name] = value === true ? "" : String(value);
	}
	return result;
}

export const DATA_ATTRS = {
	editorRoot: "data-pen-editor-root",
	editorContent: "data-pen-editor-content",
	editorBlocksHost: "data-pen-editor-blocks-host",
	viewId: "data-pen-view-id",
	editorBlock: "data-pen-editor-block",
	inlineContent: "data-pen-inline-content",
	inlineAtom: "data-pen-inline-atom",
	inlineAtomHost: "data-pen-inline-atom-host",
	inlineAtomType: "data-pen-inline-atom-type",
	inlineAtomProps: "data-pen-inline-atom-props",
	inlineAtomCaretBoundary: "data-pen-inline-atom-caret-boundary",
	emptyBlock: "data-pen-empty",
	trailingBreak: "data-pen-trailing-break",
	inlineAtomCaretSide: "data-pen-inline-atom-caret-side",
	inlineAtomDragging: "data-pen-inline-atom-dragging",
	fieldEditorSurface: "data-pen-field-editor-surface",
	fieldEditorActiveSurface: "data-pen-field-editor-active-surface",
	fieldEditor: "data-pen-field-editor",
	blockHandle: "data-pen-block-handle",
	blockId: "data-block-id",
	blockType: "data-block-type",
	selected: "data-selected",
	focused: "data-focused",
	readonly: "data-readonly",
	empty: "data-empty",
	active: "data-active",
	dragging: "data-dragging",
	selecting: "data-selecting",
	inputMode: "data-input-mode",
	streaming: "data-streaming",
	expanded: "data-expanded",
	blockCount: "data-block-count",
	surfaceMode: "data-surface-mode",
	surfaceRole: "data-surface-role",
	ignorePointerGesture: "data-pen-ignore-pointer-gesture",
	ignoreTransfer: "data-pen-ignore-transfer",
	dropTarget: "data-drop-target",
	dropPosition: "data-drop-position",
	dropCaret: "data-pen-drop-caret",
	aiGenerating: "data-ai-generating",
	placeholderVisible: "data-placeholder-visible",
	table: "data-pen-table",
	tableFrame: "data-pen-table-frame",
	tableCell: "data-pen-table-cell",
	tableCellRow: "data-cell-row",
	tableCellCol: "data-cell-col",
	overlayLayer: "data-pen-overlay-layer",
	overlayItem: "data-pen-overlay-item",
	overlayLabel: "data-pen-overlay-label",
	multiplayerCaretLabel: "data-pen-multiplayer-caret-label",
} as const;

export const OVERLAY_LAYER_ATTR = DATA_ATTRS.overlayLayer;
export const OVERLAY_ITEM_ATTR = DATA_ATTRS.overlayItem;
