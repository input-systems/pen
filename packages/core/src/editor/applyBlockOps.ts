import type {
	InsertBlockOp,
	DeleteBlockOp,
	MoveBlockOp,
	Position,
	SetPropsOp,
	StructuralOriginTag,
	TableColumnSchema,
} from "@input/pen-types";
import { STRUCTURAL_ORIGIN_META_KEY } from "@input/pen-yjs";
import { resolveRuntimeContentType } from "../schema/contentType";
import {
	type CRDTUnknownMap,
	getArrayProp,
	getMapProp,
	getTableContent,
} from "./crdtShapes";
import type { ApplyPipelineDocumentAccess } from "./applyPipelineContext";
import {
	clearTableState,
	getPreservedInlineDeltas,
} from "./applyInlineAndMetaOps";
import {
	getMutableBlockMap,
	getOrCreateMapProp,
	getOrCreateStringArrayProp,
	getTextContent,
	removeBlockIdFromAllChildren,
	removeBlockIdFromBlockOrder,
	resolvePosition,
} from "./applySharedHelpers";

type MutableMap = CRDTUnknownMap & { delete(key: string): void };

export function insertBlock(
	pipeline: ApplyPipelineDocumentAccess,
	op: InsertBlockOp,
): string[] {
	const schema = pipeline._registry.resolve(op.blockType);
	if (!schema) return [];

	const contentType = resolveRuntimeContentType(schema);
	const blockMap = pipeline._adapter.initBlockMap(
		pipeline._crdtDoc,
		op.blockId,
		op.blockType,
		contentType,
	) as MutableMap;
	pipeline._engine.noteBlockChanged(op.blockId, blockMap);

	if (op.props && Object.keys(op.props).length > 0) {
		const propsMap = getOrCreateMapProp(pipeline, blockMap, "props");
		for (const [key, value] of Object.entries(op.props)) {
			propsMap.set(key, value);
		}
	}

	if ((schema as { content: unknown }).content === "subdocument") {
		const propsMap = getOrCreateMapProp(pipeline, blockMap, "props");
		const subdocument = blockMap.get("subdocument") as
			| { guid?: unknown }
			| undefined;
		if (
			subdocument &&
			typeof subdocument === "object" &&
			typeof subdocument.guid === "string"
		) {
			propsMap.set("subdocumentGuid", subdocument.guid);
		}
	}

	placeBlockId(pipeline, op.blockId, op.position);

	return [op.blockId];
}

export function deleteBlock(
	pipeline: ApplyPipelineDocumentAccess,
	op: DeleteBlockOp,
): string[] {
	const descendants = childrenArrayDescendants(pipeline, op.blockId);
	pipeline.mutableBlocks.delete(op.blockId);
	pipeline._engine.noteBlockChanged(op.blockId, undefined);
	// A `children` array lives inside its container's block map, so deleting
	// the container drops every entry for its children: their block maps
	// would survive in no array, rendered nowhere. They go with it. `parentId`
	// children sit in `blockOrder` and are promoted by normalization instead.
	for (const descendantId of descendants) {
		pipeline.mutableBlocks.delete(descendantId);
		pipeline._engine.noteBlockChanged(descendantId, undefined);
	}
	removeBlockIdFromBlockOrder(pipeline, op.blockId);
	removeBlockIdFromAllChildren(pipeline, op.blockId);

	return [op.blockId];
}

/** Every block under `blockId` through `children` arrays, at any depth. */
function childrenArrayDescendants(
	pipeline: ApplyPipelineDocumentAccess,
	blockId: string,
): string[] {
	const descendants: string[] = [];
	const seen = new Set<string>([blockId]);
	const visit = (parentId: string): void => {
		const parentMap = getMutableBlockMap(pipeline, parentId);
		const children = parentMap ? getArrayProp<string>(parentMap, "children") : null;
		if (!children) return;
		for (let i = 0; i < children.length; i++) {
			const childId = children.get(i);
			if (seen.has(childId)) continue;
			seen.add(childId);
			descendants.push(childId);
			visit(childId);
		}
	};
	visit(blockId);
	return descendants;
}

export function moveBlock(
	pipeline: ApplyPipelineDocumentAccess,
	op: MoveBlockOp,
): string[] {
	removeBlockIdFromBlockOrder(pipeline, op.blockId, true);
	removeBlockIdFromAllChildren(pipeline, op.blockId);

	placeBlockId(pipeline, op.blockId, op.position);

	return [op.blockId];
}

/** Inserts `blockId` at `position`: a parent's `children`, or the root order. */
function placeBlockId(
	pipeline: ApplyPipelineDocumentAccess,
	blockId: string,
	position: Position,
): void {
	if (typeof position === "object" && "parent" in position) {
		const parentMap = getMutableBlockMap(pipeline, position.parent);
		if (parentMap) {
			const children = getOrCreateStringArrayProp(
				pipeline,
				parentMap,
				"children",
			);
			const idx = Math.min(position.index, children.length);
			children.insert(idx, [blockId]);
			pipeline._engine.noteBlockChanged(position.parent, parentMap);
		}
	} else {
		const idx = resolvePosition(pipeline, position);
		pipeline.mutableBlockOrder.insert(idx, [blockId]);
		pipeline._engine.noteRootInserted(idx, [blockId]);
	}
}

function convertBlock(
	pipeline: ApplyPipelineDocumentAccess,
	blockId: string,
	newType: string,
	newProps?: Record<string, unknown>,
): string[] {
	const blockMap = getMutableBlockMap(pipeline, blockId);
	if (!blockMap) return [];

	const oldType = blockMap.get("type") as string;
	const oldSchema = pipeline._registry.resolve(oldType);
	const newSchema = pipeline._registry.resolve(newType);
	if (!newSchema) return [];

	blockMap.set("type", newType);

	const propsMap = getMapProp(blockMap, "props");
	if (propsMap) {
		const mutablePropsMap = propsMap as MutableMap;
		const newPropKeys = new Set(Object.keys(newSchema.propSchema ?? {}));
		for (const key of [...(mutablePropsMap.keys?.() ?? [])]) {
			if (!newPropKeys.has(key)) {
				mutablePropsMap.delete(key);
			}
		}
	}

	if (newProps) {
		const props = getOrCreateMapProp(pipeline, blockMap, "props");
		for (const [key, value] of Object.entries(newProps)) {
			props.set(key, value);
		}
	}

	const oldContent = oldSchema?.content;
	const newContent = newSchema.content;
	const preservedInlineDeltas =
		oldContent === "inline"
			? getPreservedInlineDeltas(getTextContent(pipeline, blockMap))
			: [];

	if (oldContent === "inline" && newContent !== "inline") {
		if (
			newContent === "none" ||
			newContent === "table" ||
			Array.isArray(newContent)
		) {
			blockMap.delete("content");
		}
	} else if (oldContent !== "inline" && newContent === "inline") {
		const ytext = pipeline._adapter.createText();
		blockMap.set("content", ytext);
	}

	const targetContent = resolveRuntimeContentType(newSchema);
	if (targetContent === "table") {
		blockMap.delete("tableColumns");
	} else {
		clearTableState(blockMap);
	}

	if (targetContent === "table" && !getTableContent(blockMap)) {
		pipeline._tableGrid.seedTableBlock(blockMap, {
			rowCount: 2,
			colCount: 2,
			preservedInlineDeltas,
		});
	}

	return [blockId];
}

function applyLayoutReplacement(
	pipeline: ApplyPipelineDocumentAccess,
	blockMap: MutableMap,
	layout: unknown,
): void {
	if (layout === null) {
		blockMap.delete("layout");
		return;
	}
	if (
		layout === undefined ||
		typeof layout !== "object" ||
		Array.isArray(layout)
	) {
		return;
	}
	const layoutMap = getOrCreateMapProp(pipeline, blockMap, "layout");
	const next = layout as Record<string, unknown>;
	for (const key of [...(layoutMap.keys?.() ?? [])]) {
		if (!(key in next)) {
			layoutMap.delete(key);
		}
	}
	for (const [key, value] of Object.entries(next)) {
		if (value === undefined || value === null) {
			layoutMap.delete(key);
		} else {
			layoutMap.set(key, value);
		}
	}
}

export function setProps(
	pipeline: ApplyPipelineDocumentAccess,
	op: SetPropsOp,
): string[] {
	const blockMap = getMutableBlockMap(pipeline, op.blockId);
	if (!blockMap) return [];

	const nextType = op.props.type;
	const layout = op.props.layout;
	const columns = op.props.columns;
	const regular: Record<string, unknown | null> = {};
	for (const [key, value] of Object.entries(op.props)) {
		if (key === "type" || key === "layout" || key === "columns") {
			continue;
		}
		regular[key] = value;
	}

	if (typeof nextType === "string") {
		const newProps: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(regular)) {
			if (value !== undefined && value !== null) {
				newProps[key] = value;
			}
		}
		convertBlock(pipeline, op.blockId, nextType, newProps);
		const propsMap = getOrCreateMapProp(pipeline, blockMap, "props");
		for (const [key, value] of Object.entries(regular)) {
			if (value === null) {
				propsMap.delete(key);
			}
		}
	} else {
		const propsMap = getOrCreateMapProp(pipeline, blockMap, "props");
		for (const [key, value] of Object.entries(regular)) {
			if (value === undefined || value === null) {
				propsMap.delete(key);
			} else {
				propsMap.set(key, value);
			}
		}
	}

	if (layout !== undefined) {
		applyLayoutReplacement(pipeline, blockMap, layout);
	}

	if (columns !== undefined) {
		if (columns === null) {
			blockMap.delete("tableColumns");
		} else if (Array.isArray(columns)) {
			pipeline._tableGrid.setStructuredTableColumns(
				blockMap,
				columns as TableColumnSchema[],
			);
		}
	}

	return [op.blockId];
}

export function tagStructuralOrigin(
	pipeline: Pick<ApplyPipelineDocumentAccess, "_adapter" | "_crdtDoc">,
	structural: StructuralOriginTag,
): void {
	const raw = pipeline._adapter.raw?.(pipeline._crdtDoc) as
		| { _transaction?: { meta?: Map<unknown, unknown> } }
		| undefined;
	const txn = raw?._transaction;
	txn?.meta?.set(STRUCTURAL_ORIGIN_META_KEY, structural);
}
