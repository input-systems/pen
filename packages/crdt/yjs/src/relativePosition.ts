import type {
	AnchorTarget,
	Assoc,
	CRDTDocument,
	ResolveRelativePositionOptions,
} from "@input/pen-types";
import * as Y from "yjs";

import { asYjsDoc } from "./document";

type DeletedFlag = { _item?: { deleted?: boolean } | null };

function clampOffset(offset: number, length: number): number {
	if (!Number.isFinite(offset) || offset < 0) {
		return 0;
	}
	return Math.max(0, Math.min(Math.trunc(offset), length));
}

function isDeletedType(type: object): boolean {
	return (type as DeletedFlag)._item?.deleted === true;
}

function cellText(
	blockMap: Y.Map<unknown>,
	row: number,
	col: number,
): Y.Text | null {
	const table = blockMap.get("tableContent");
	if (!(table instanceof Y.Array)) {
		return null;
	}
	if (row < 0 || row >= table.length) {
		return null;
	}
	const rowMap = table.get(row);
	if (!(rowMap instanceof Y.Map)) {
		return null;
	}
	const cells = rowMap.get("cells");
	if (!(cells instanceof Y.Array)) {
		return null;
	}
	if (col < 0 || col >= cells.length) {
		return null;
	}
	const cell = cells.get(col);
	if (!(cell instanceof Y.Map)) {
		return null;
	}
	const content = cell.get("content");
	return content instanceof Y.Text ? content : null;
}

function textForTarget(
	blocks: Y.Map<Y.Map<unknown>>,
	target: AnchorTarget,
): Y.Text | null {
	const blockMap = blocks.get(target.blockId);
	if (!blockMap) {
		return null;
	}
	if (target.cell) {
		return cellText(blockMap, target.cell.row, target.cell.col);
	}
	const content = blockMap.get("content");
	return content instanceof Y.Text ? content : null;
}

type ParentLink = { _item?: { parent: unknown; parentSub: string | null } | null };

/** The type `child` sits in, and the map key it sits under (null inside an array). */
function parentOf(child: object): { parent: object; key: string | null } | null {
	const item = (child as ParentLink)._item;
	if (item == null || item.parent == null || typeof item.parent !== "object") {
		return null;
	}
	return { parent: item.parent, key: item.parentSub };
}

function indexIn(array: Y.Array<unknown>, child: object): number {
	for (let i = 0; i < array.length; i++) {
		if (array.get(i) === child) return i;
	}
	return -1;
}

/**
 * Which block (and table cell) owns `ytext`, by walking up its parents:
 * O(depth), plus O(row + col) for a cell, never a scan of every block (SCALE2).
 * Block content is `blocks[id].content`; cell content is
 * `blocks[id].tableContent[row].cells[col].content`.
 */
function locateText(
	blocks: Y.Map<Y.Map<unknown>>,
	ytext: object,
): Omit<AnchorTarget, "offset"> | null {
	const owner = parentOf(ytext);
	if (!owner || owner.key !== "content" || !(owner.parent instanceof Y.Map)) {
		return null;
	}
	const container = parentOf(owner.parent);
	if (!container) return null;
	if (container.parent === blocks) {
		return container.key !== null && blocks.get(container.key) === owner.parent
			? { blockId: container.key }
			: null;
	}
	return locateCell(blocks, owner.parent, container);
}

/** The `Y.Map` `child` sits in under `key`, else null. */
function parentMap(child: object, key: string): Y.Map<unknown> | null {
	const link = parentOf(child);
	return link?.key === key && link.parent instanceof Y.Map ? link.parent : null;
}

/** The `Y.Array` `child` sits in, else null. */
function parentArray(child: object): Y.Array<unknown> | null {
	const link = parentOf(child);
	return link?.parent instanceof Y.Array ? link.parent : null;
}

/** The block id owning a `tableContent` array, when it is a live block. */
function tableOwner(blocks: Y.Map<Y.Map<unknown>>, table: Y.Array<unknown>): string | null {
	const blockMap = parentMap(table, "tableContent");
	const link = blockMap && parentOf(blockMap);
	return link?.parent === blocks ? link.key : null;
}

/** `blocks[id].tableContent[row].cells[col]` → `{ blockId, cell }`. */
function locateCell(
	blocks: Y.Map<Y.Map<unknown>>,
	cell: Y.Map<unknown>,
	cells: { parent: object; key: string | null },
): Omit<AnchorTarget, "offset"> | null {
	if (!(cells.parent instanceof Y.Array)) return null;
	const rowMap = parentMap(cells.parent, "cells");
	const table = rowMap && parentArray(rowMap);
	const blockId = table && tableOwner(blocks, table);
	if (!rowMap || !table || !blockId) return null;
	const row = indexIn(table, rowMap);
	const col = indexIn(cells.parent, cell);
	return row < 0 || col < 0 ? null : { blockId, cell: { row, col } };
}

export function createRelativePosition(
	doc: CRDTDocument,
	target: AnchorTarget,
	assoc: Assoc,
): Uint8Array | null {
	const yjsDoc = asYjsDoc(doc);
	const text = textForTarget(yjsDoc.penDocument.blocks, target);
	if (!text || isDeletedType(text)) {
		return null;
	}
	const yjsAssoc = assoc === -1 ? -1 : 1;
	const relative = Y.createRelativePositionFromTypeIndex(
		text as never,
		clampOffset(target.offset, text.length),
		yjsAssoc,
	);
	return Y.encodeRelativePosition(relative);
}

export function resolveRelativePosition(
	doc: CRDTDocument,
	encoded: Uint8Array,
	options?: ResolveRelativePositionOptions,
): AnchorTarget | null {
	try {
		const yjsDoc = asYjsDoc(doc);
		const relative = Y.decodeRelativePosition(encoded);
		const absolute = Y.createAbsolutePositionFromRelativePosition(
			relative,
			yjsDoc.ydoc,
			options?.followUndoneDeletions ?? true,
		);
		if (!absolute || isDeletedType(absolute.type)) {
			return null;
		}
		const owner = locateText(yjsDoc.penDocument.blocks, absolute.type);
		if (!owner) {
			return null;
		}
		if (!(absolute.type instanceof Y.Text)) {
			return null;
		}
		const offset = clampOffset(absolute.index, absolute.type.length);
		return owner.cell
			? { blockId: owner.blockId, offset, cell: owner.cell }
			: { blockId: owner.blockId, offset };
	} catch {
		return null;
	}
}
