import type {
	AppHandle,
	AppPlacement,
	BlockCapabilityKey,
	BlockCapabilityMap,
	BlockHandle,
	BlockSchema,
	ContentType,
	InlineDelta,
	TableBlockHandle,
	TableCellHandle,
	TableColumnSchema,
	TableRowHandle,
	CRDTDocument,
	LayoutProps,
	PenDocument,
	SchemaRegistry,
} from "@input/pen-types";
import {
	crdtMapToPlainRecord,
	getCellMap,
	getMapProp,
	getRowCells,
	getStringProp,
	getTableColumns,
	getTableContent,
	getTextProp,
	isCRDTMap,
	type CRDTUnknownMap,
} from "../editor/crdtShapes";
import { AppHandleImpl } from "./appHandleImpl";
import {
	arrayValues,
	getChildrenArray,
	getDeltaFragments,
	getMapEntries,
	getPropsMap,
	resolveText,
	toInlineDeltas,
	toTableColumnSchema,
} from "./handleValueHelpers";
import { TableCellHandleImpl } from "./tableCellHandleImpl";

// ── Factory Functions ───────────────────────────────────────

export function createBlockHandle(
	blockId: string,
	doc: PenDocument,
	crdtDoc: CRDTDocument,
	registry: SchemaRegistry,
): BlockHandle {
	return new BlockHandleImpl(blockId, doc, crdtDoc, registry);
}

export function createAppHandle(
	appId: string,
	doc: PenDocument,
	crdtDoc: CRDTDocument,
	registry: SchemaRegistry,
): AppHandle {
	return new AppHandleImpl(appId, doc, crdtDoc, registry, createBlockHandle);
}

// ── BlockHandleImpl ─────────────────────────────────────────

const EMPTY_TABLE_COLUMNS: readonly TableColumnSchema[] = [];

class TableRowHandleImpl implements TableRowHandle {
	constructor(
		readonly id: string,
		readonly index: number,
	) {}
}

class BlockHandleImpl implements TableBlockHandle {
	constructor(
		private readonly _id: string,
		private readonly _doc: PenDocument,
		private readonly _crdtDoc: CRDTDocument,
		private readonly _registry: SchemaRegistry,
	) {}

	get id(): string {
		return this._id;
	}

	get type(): string {
		return this.blockMap.get("type") as string;
	}

	get props(): Readonly<Record<string, unknown>> {
		const schema = this._registry.resolve(this.type);
		const props: Record<string, unknown> = {};

		if (schema?.propSchema) {
			for (const [key, propDef] of Object.entries(schema.propSchema)) {
				const defaultValue = (propDef as Record<string, unknown>)
					.default;
				if (defaultValue !== undefined) {
					props[key] = defaultValue;
				}
			}
		}
		for (const [key, value] of getMapEntries(getPropsMap(this.blockMap))) {
			props[key] = value;
		}
		return props;
	}

	get index(): number {
		for (let i = 0; i < this._doc.blockOrder.length; i++) {
			if (this._doc.blockOrder.get(i) === this._id) return i;
		}
		return -1;
	}

	get prev(): BlockHandle | null {
		const idx = this.index;
		if (idx <= 0) return null;
		return new BlockHandleImpl(
			this._doc.blockOrder.get(idx - 1),
			this._doc,
			this._crdtDoc,
			this._registry,
		);
	}

	get next(): BlockHandle | null {
		const idx = this.index;
		if (idx < 0 || idx >= this._doc.blockOrder.length - 1) return null;
		return new BlockHandleImpl(
			this._doc.blockOrder.get(idx + 1),
			this._doc,
			this._crdtDoc,
			this._registry,
		);
	}

	get parent(): BlockHandle | null {
		const parentId = (this.props as Record<string, unknown>).parentId as
			| string
			| undefined;
		if (parentId && this._doc.blocks.has(parentId)) {
			return new BlockHandleImpl(
				parentId,
				this._doc,
				this._crdtDoc,
				this._registry,
			);
		}

		for (const [id, rawBlockMap] of this._doc.blocks.entries()) {
			if (!isCRDTMap(rawBlockMap)) continue;
			const children = getChildrenArray(rawBlockMap);
			if (!children) continue;
			for (let i = 0; i < children.length; i++) {
				if (children.get(i) === this._id) {
					return new BlockHandleImpl(
						id,
						this._doc,
						this._crdtDoc,
						this._registry,
					);
				}
			}
		}

		return null;
	}

	get children(): readonly BlockHandle[] {
		const result: BlockHandle[] = [];

		// parentId-based children (toggle/callout/blockquote)
		for (let i = 0; i < this._doc.blockOrder.length; i++) {
			const childId = this._doc.blockOrder.get(i);
			const childMap = this._doc.blocks.get(childId);
			if (!isCRDTMap(childMap)) continue;
			const childProps = getPropsMap(childMap);
			if (childProps?.get("parentId") === this._id) {
				result.push(
					new BlockHandleImpl(
						childId,
						this._doc,
						this._crdtDoc,
						this._registry,
					),
				);
			}
		}

		// children Y.Array (layout containers)
		const childrenArr = getChildrenArray(this.blockMap);
		if (childrenArr) {
			for (let i = 0; i < childrenArr.length; i++) {
				result.push(
					new BlockHandleImpl(
						childrenArr.get(i),
						this._doc,
						this._crdtDoc,
						this._registry,
					),
				);
			}
		}

		return result;
	}

	// ── Traversal ─────────────────────────────────────────

	*descendants(type?: string): Iterable<BlockHandle> {
		for (const child of this.children) {
			if (!type || child.type === type) yield child;
			yield* child.descendants(type);
		}
	}

	*ancestors(): Iterable<BlockHandle> {
		let current: BlockHandle | null = this.parent;
		while (current) {
			yield current;
			current = current.parent;
		}
	}

	*siblings(): Iterable<BlockHandle> {
		const par = this.parent;
		if (par) {
			for (const child of par.children) {
				if (child.id !== this._id) yield child;
			}
		} else {
			for (let i = 0; i < this._doc.blockOrder.length; i++) {
				const sibId = this._doc.blockOrder.get(i);
				if (sibId === this._id) continue;
				const sibMap = this._doc.blocks.get(sibId);
				if (!isCRDTMap(sibMap)) continue;
				const sibProps = getPropsMap(sibMap);
				if (!sibProps?.get("parentId")) {
					yield new BlockHandleImpl(
						sibId,
						this._doc,
						this._crdtDoc,
						this._registry,
					);
				}
			}
		}
	}

	// ── Layout queries ────────────────────────────────────

	get layout(): LayoutProps | null {
		const layoutMap = getMapProp(this.blockMap, "layout");
		if (!layoutMap) return null;
		const result: Record<string, unknown> = {};
		for (const [key, value] of getMapEntries(layoutMap)) {
			result[key] = value;
		}
		return result as unknown as LayoutProps;
	}

	get isLayoutChild(): boolean {
		return this.layoutParent() !== null;
	}

	layoutParent(): BlockHandle | null {
		for (const [id, rawBlockMap] of this._doc.blocks.entries()) {
			if (!isCRDTMap(rawBlockMap)) continue;
			const children = getChildrenArray(rawBlockMap);
			if (!children) continue;
			for (let i = 0; i < children.length; i++) {
				if (children.get(i) === this._id) {
					return new BlockHandleImpl(
						id,
						this._doc,
						this._crdtDoc,
						this._registry,
					);
				}
			}
		}
		return null;
	}

	// ── App queries ───────────────────────────────────────

	anchoredApps(): readonly AppHandle[] {
		const result: AppHandle[] = [];
		for (const [appId, rawAppMap] of this._doc.apps.entries()) {
			if (!isCRDTMap(rawAppMap)) continue;
			const placement = rawAppMap.get("placement") as
				| AppPlacement
				| undefined;
			if (
				placement &&
				"blockId" in placement &&
				placement.blockId === this._id
			) {
				result.push(
					new AppHandleImpl(
						appId,
						this._doc,
						this._crdtDoc,
						this._registry,
						createBlockHandle,
					),
				);
			}
		}
		return result;
	}

	// ── Content access ────────────────────────────────────

	textContent(options?: { resolved?: boolean }): string {
		const content = getTextProp(this.blockMap, "content");
		if (content) {
			const text = content.toString();
			if (options?.resolved) {
				return resolveText(content);
			}
			return text;
		}
		return "";
	}

	inlineDeltas(): InlineDelta[] {
		const content = getTextProp(this.blockMap, "content");
		return toInlineDeltas(content);
	}

	textDeltas(): Array<{
		insert: string;
		attributes?: Record<string, unknown>;
	}> {
		return this.inlineDeltas().map((delta) => ({
			insert: typeof delta.insert === "string" ? delta.insert : "",
			...(delta.attributes ? { attributes: delta.attributes } : {}),
		}));
	}

	/** Logical length: each character and each inline embed is one offset (N1). */
	length(): number {
		const content = getTextProp(this.blockMap, "content");
		return content ? content.length : 0;
	}

	as<K extends BlockCapabilityKey>(
		capability: K,
	): BlockCapabilityMap[K] | null {
		if (
			!schemaDeclaresBlockCapability(
				this._registry.resolve(this.type),
				capability,
			)
		) {
			return null;
		}
		return this as BlockCapabilityMap[K];
	}

	// ── Metadata ──────────────────────────────────────────

	meta(namespace: string): Readonly<Record<string, unknown>> | null {
		const metaMap = getMapProp(this.blockMap, "meta");
		if (!metaMap) return null;
		const nsData = metaMap.get(namespace);
		if (!nsData) return null;
		if (isCRDTMap(nsData)) {
			return crdtMapToPlainRecord(nsData);
		}
		return nsData as Record<string, unknown>;
	}

	setMeta(_namespace: string, _data: Record<string, unknown>): void {
		throw new Error(
			'BlockHandle.setMeta() has been removed. Use editor.apply({ type: "set-meta", blockId, namespace, data }) instead.',
		);
	}

	// ── Table access ──────────────────────────────────────

	tableRowCount(): number {
		if (!this.isGridBlock()) return 0;
		return getTableContent(this.blockMap)?.length ?? 0;
	}

	tableColumnCount(): number {
		if (!this.isGridBlock()) return 0;
		const tc = getTableContent(this.blockMap);
		const structuredColumnCount = this.tableColumns().length;
		if (!tc || tc.length === 0) return structuredColumnCount;
		let rowCellCount = 0;
		for (let rowIndex = 0; rowIndex < tc.length; rowIndex++) {
			const rowMap = tc.get(rowIndex);
			if (!isCRDTMap(rowMap)) continue;
			const cells = getRowCells(rowMap);
			const cellCount = cells ? cells.length : 0;
			rowCellCount = Math.max(rowCellCount, cellCount);
		}
		return Math.max(rowCellCount, structuredColumnCount);
	}

	tableRow(row: number): TableRowHandle | null {
		if (!this.isGridBlock()) return null;
		const tc = getTableContent(this.blockMap);
		if (!tc || row < 0 || row >= tc.length) return null;
		const rowMap = tc.get(row);
		if (!isCRDTMap(rowMap)) return null;
		const id = getStringProp(rowMap, "id");
		if (typeof id !== "string" || id.length === 0) return null;
		return new TableRowHandleImpl(id, row);
	}

	tableCell(row: number, col: number): TableCellHandle | null {
		if (!this.isGridBlock()) return null;
		const tc = getTableContent(this.blockMap);
		if (!tc || row < 0 || row >= tc.length) return null;
		const rowMap = tc.get(row);
		if (!isCRDTMap(rowMap)) return null;
		const cellMap = getCellMap(rowMap, col);
		if (!cellMap) return null;
		return new TableCellHandleImpl(cellMap, row, col);
	}

	tableColumns(): readonly TableColumnSchema[] {
		if (this.type !== "table") return EMPTY_TABLE_COLUMNS;
		const raw = this.blockMap.get("tableColumns");
		if (!raw) return EMPTY_TABLE_COLUMNS;
		if (typeof raw === "string") {
			try {
				return JSON.parse(raw) as TableColumnSchema[];
			} catch {
				// stored column json was unreadable; treat as no columns.
				return EMPTY_TABLE_COLUMNS;
			}
		}
		const columns = getTableColumns(this.blockMap);
		if (!columns) return EMPTY_TABLE_COLUMNS;
		return arrayValues(columns)
			.map((column) => toTableColumnSchema(column))
			.filter((column): column is TableColumnSchema => column !== null);
	}

	// ── Internal ──────────────────────────────────────────

	private isGridBlock(): boolean {
		return this.type === "table";
	}

	private get blockMap(): CRDTUnknownMap {
		const map = this._doc.blocks.get(this._id);
		if (!isCRDTMap(map)) throw new Error(`Block not found: ${this._id}`);
		return map;
	}
}

function schemaDeclaresBlockCapability(
	schema: BlockSchema | null,
	capability: BlockCapabilityKey,
): boolean {
	if (!schema) {
		return false;
	}
	const content = schema.content as ContentType;
	switch (capability) {
		case "table":
			return content === "table" || schema.fieldEditor === "table";
		default: {
			const _exhaustive: never = capability;
			void _exhaustive;
			return false;
		}
	}
}
