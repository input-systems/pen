import type { CRDTArray, DocumentOp, Position } from "@input/pen-types";
import {
	type CRDTInlineTextLike,
	type CRDTTextLike,
	type CRDTUnknownArray,
	type CRDTUnknownMap,
	getArrayProp,
	getMapProp,
} from "./crdtShapes";
import type { ApplyPipelineDocumentAccess } from "./applyPipelineContext";

type MutableMap = CRDTUnknownMap & { delete(key: string): void };
type MutableStringArray = CRDTUnknownArray<string>;

export function blockExists(
	pipeline: Pick<ApplyPipelineDocumentAccess, "blocks">,
	blockId: string,
): boolean {
	return pipeline.blocks.has(blockId);
}

export function createMutableMap(
	pipeline: Pick<ApplyPipelineDocumentAccess, "_adapter">,
): MutableMap {
	return pipeline._adapter.createMap() as MutableMap;
}

export function getMutableBlockMap(
	pipeline: Pick<ApplyPipelineDocumentAccess, "blocks">,
	blockId: string,
): MutableMap | null {
	return (
		(pipeline.blocks.get(blockId) as unknown as MutableMap | undefined) ??
		null
	);
}

export function getMutableAppMap(
	pipeline: Pick<ApplyPipelineDocumentAccess, "apps">,
	appId: string,
): MutableMap | null {
	return (
		(pipeline.apps.get(appId) as unknown as MutableMap | undefined) ?? null
	);
}

export function getOrCreateMapProp(
	pipeline: Pick<ApplyPipelineDocumentAccess, "_adapter">,
	container: CRDTUnknownMap,
	key: string,
): MutableMap {
	const existing = getMapProp(container, key);
	if (existing) {
		return existing as MutableMap;
	}
	const map = createMutableMap(pipeline);
	container.set(key, map);
	return map;
}

export function getOrCreateStringArrayProp(
	pipeline: Pick<ApplyPipelineDocumentAccess, "_adapter">,
	container: CRDTUnknownMap,
	key: string,
): MutableStringArray {
	const existing = getArrayProp<string>(container, key);
	if (existing) {
		return existing as MutableStringArray;
	}
	const array = pipeline._adapter.createArray() as MutableStringArray;
	container.set(key, array);
	return array;
}

/**
 * Deletes the block's `blockOrder` entries, last first; `lastOnly` stops
 * after one. The entries come from the normalizer's pass index, so the order
 * is not scanned (SCALE2).
 */
export function removeBlockIdFromBlockOrder(
	pipeline: Pick<ApplyPipelineDocumentAccess, "mutableBlockOrder" | "_engine">,
	blockId: string,
	lastOnly = false,
): void {
	const indices = pipeline._engine.structure().rootIndicesOf(blockId);
	for (let at = indices.length - 1; at >= 0; at--) {
		pipeline.mutableBlockOrder.delete(indices[at]!, 1);
		pipeline._engine.noteRootDeleted(indices[at]!, 1);
		if (lastOnly) return;
	}
}

/** Deletes the block's entries from every `children` array the pass index says lists it. */
export function removeBlockIdFromAllChildren(
	pipeline: Pick<ApplyPipelineDocumentAccess, "blocks" | "_engine">,
	blockId: string,
): void {
	const parents =
		pipeline._engine.structure().parentsByChild.get(blockId) ?? [];
	for (const parentId of [...parents]) {
		const parentMap = pipeline.blocks.get(parentId) as unknown as
			| CRDTUnknownMap
			| undefined;
		const children = parentMap
			? (getArrayProp<string>(parentMap, "children") as MutableStringArray | null)
			: null;
		if (!children) continue;
		for (let index = children.length - 1; index >= 0; index--) {
			if (children.get(index) === blockId) children.delete(index, 1);
		}
		pipeline._engine.noteBlockChanged(parentId, parentMap);
	}
}

export function getTextContent(
	_pipeline: Pick<ApplyPipelineDocumentAccess, "blocks">,
	blockMap: CRDTUnknownMap,
): CRDTTextLike | undefined {
	const content = blockMap.get("content");
	return content &&
		typeof content === "object" &&
		typeof (content as { insert?: unknown }).insert === "function" &&
		typeof (content as { delete?: unknown }).delete === "function" &&
		typeof (content as { format?: unknown }).format === "function" &&
		typeof (content as { toDelta?: unknown }).toDelta === "function" &&
		typeof (content as { toString?: unknown }).toString === "function" &&
		typeof (content as { length?: unknown }).length === "number"
		? (content as CRDTTextLike)
		: undefined;
}

export function getInlineTextContent(
	pipeline: Pick<ApplyPipelineDocumentAccess, "blocks">,
	blockMap: CRDTUnknownMap,
): CRDTInlineTextLike | undefined {
	const content = getTextContent(pipeline, blockMap);
	return content &&
		typeof (content as { insertEmbed?: unknown }).insertEmbed === "function"
		? (content as CRDTInlineTextLike)
		: undefined;
}

export function resolvePosition(
	pipeline: Pick<ApplyPipelineDocumentAccess, "_doc" | "blocks" | "_engine">,
	position: Position,
): number {
	const blockOrder = pipeline._doc.blockOrder;

	if (position === "first") return 0;
	if (position === "last") return blockOrder.length;

	// The first entry, read from the pass index rather than the order (SCALE2).
	if (typeof position === "object" && "after" in position) {
		const at = pipeline._engine.structure().rootIndexOf(position.after);
		return at < 0 ? blockOrder.length : at + 1;
	}

	if (typeof position === "object" && "before" in position) {
		const at = pipeline._engine.structure().rootIndexOf(position.before);
		return at < 0 ? 0 : at;
	}

	if (typeof position === "object" && "parent" in position) {
		const parentMap = pipeline.blocks.get(position.parent);
		if (!parentMap) return blockOrder.length;
		const children = parentMap.get("children") as
			| CRDTArray<string>
			| undefined;
		if (!children) return 0;
		return Math.min(position.index, children.length);
	}

	return blockOrder.length;
}

export function opBlockId(_pipeline: unknown, op: DocumentOp): string | null {
	if ("blockId" in op) return (op as { blockId: string }).blockId;
	if ("targetBlockId" in op)
		return (op as { targetBlockId: string }).targetBlockId;
	if ("appId" in op) return null;
	return null;
}
