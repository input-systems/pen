import type { CRDTAdapter, GridOp, TableColumnSchema } from "@input/pen-types";
import { generateId } from "@input/pen-types";
import {
	type CRDTUnknownArray,
	type CRDTUnknownMap,
	getRowCells,
	getStringProp,
	getTableColumns,
	getTableContent,
	isCRDTMap,
	type TableCellMap,
	type TableContentArray,
} from "./crdtShapes";
import {
	captureTableRowSnapshot,
	createRecordMap,
	ensureCellContent,
	getCellContent,
	type TableRowSnapshot,
	writeCellDeltas,
} from "./tableGridCellHelpers";

export type TableCellDelta = {
	insert: string;
	attributes?: Record<string, unknown>;
};

export class TableGridExecutor {
	private readonly _adapter: CRDTAdapter;

	constructor(adapter: CRDTAdapter) {
		this._adapter = adapter;
	}

	execute(blockMap: CRDTUnknownMap, op: GridOp): string[] {
		const tableContent = getTableContent(blockMap);
		if (!tableContent) {
			return [];
		}

		switch (op.change.kind) {
			case "insert-row": {
				const row = this.createTableRow(
					this.resolveGridColumnCount(blockMap),
				);
				tableContent.insert(op.change.index, [row]);
				break;
			}
			case "delete-row": {
				if (op.change.index < tableContent.length) {
					tableContent.delete(op.change.index, 1);
				}
				break;
			}
			case "insert-column": {
				const { index } = op.change;
				forEachRowCells(tableContent, (cells) => {
					cells.insert(index, [this.createTableCell()]);
				});
				break;
			}
			case "delete-column": {
				const { index } = op.change;
				forEachRowCells(tableContent, (cells) => {
					if (index < cells.length) {
						cells.delete(index, 1);
					}
				});
				break;
			}
			case "merge-cells":
			case "split-cell":
				break;
			default: {
				const _exhaustive: never = op.change;
				void _exhaustive;
				break;
			}
		}

		return [op.blockId];
	}

	seedTableBlock(
		blockMap: CRDTUnknownMap,
		options?: {
			rowCount?: number;
			colCount?: number;
			preservedInlineDeltas?: TableCellDelta[];
		},
	): void {
		if (blockMap.get("tableContent")) {
			return;
		}

		const rowCount = Math.max(1, options?.rowCount ?? 2);
		const colCount = Math.max(1, options?.colCount ?? 2);
		const tableContent =
			this._adapter.createArray() as CRDTUnknownArray<CRDTUnknownMap>;
		for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
			tableContent.insert(rowIndex, [this.createTableRow(colCount)]);
		}
		blockMap.set("tableContent", tableContent);

		const preservedInlineDeltas = options?.preservedInlineDeltas ?? [];
		if (preservedInlineDeltas.length > 0) {
			const firstRow = tableContent.get(0);
			if (firstRow && isCRDTMap(firstRow)) {
				this.writeDeltasToTableCell(firstRow, 0, preservedInlineDeltas);
			}
		}
	}

	createTableCell(): CRDTUnknownMap {
		const cell = this._adapter.createMap() as CRDTUnknownMap;
		cell.set("id", generateId());
		cell.set("content", this._adapter.createText());
		return cell;
	}

	createTableRow(colCount: number): CRDTUnknownMap {
		const row = this._adapter.createMap() as CRDTUnknownMap;
		row.set("id", generateId());
		const cells =
			this._adapter.createArray() as CRDTUnknownArray<CRDTUnknownMap>;
		for (let columnIndex = 0; columnIndex < colCount; columnIndex++) {
			cells.insert(columnIndex, [this.createTableCell()]);
		}
		row.set("cells", cells);
		return row;
	}

	writeDeltasToTableCell(
		row: CRDTUnknownMap,
		col: number,
		deltas: TableCellDelta[],
	): void {
		const content = getCellContent(row, col);
		if (!content) {
			return;
		}

		for (const delta of deltas) {
			content.insert(content.length, delta.insert, delta.attributes);
		}
	}

	readTableCellText(rowMap: CRDTUnknownMap, columnIndex: number): string {
		const content = getCellContent(rowMap, columnIndex);
		if (content && typeof content.toString === "function") {
			return content.toString();
		}
		return "";
	}

	writePlainTextToTableCell(
		rowMap: CRDTUnknownMap,
		columnIndex: number,
		value: string,
	): void {
		const content = ensureCellContent(rowMap, columnIndex, () =>
			this.createTableCell(),
		);
		if (!content) {
			return;
		}

		const current =
			typeof content.toString === "function" ? content.toString() : "";
		if (typeof content.delete === "function" && current.length > 0) {
			content.delete(0, current.length);
		}
		if (typeof content.insert === "function" && value.length > 0) {
			content.insert(0, value);
		}
	}

	readRowValues(rowMap: CRDTUnknownMap): string[] {
		const cells = getRowCells(rowMap);
		const colCount = cells?.length ?? 0;
		const values: string[] = [];
		for (let columnIndex = 0; columnIndex < colCount; columnIndex++) {
			values.push(this.readTableCellText(rowMap, columnIndex));
		}
		return values;
	}

	writeRowValues(rowMap: CRDTUnknownMap, values: string[]): void {
		for (let columnIndex = 0; columnIndex < values.length; columnIndex++) {
			this.writePlainTextToTableCell(
				rowMap,
				columnIndex,
				values[columnIndex] ?? "",
			);
		}
	}

	cloneTableRow(
		sourceRow: CRDTUnknownMap,
		options?: {
			rowId?: string;
			preserveCellIds?: boolean;
		},
	): CRDTUnknownMap {
		const snapshot = this.captureTableRowSnapshot(sourceRow);
		const clonedRow = this.createTableRow(snapshot.cells.length);
		this.applyTableRowSnapshot(clonedRow, snapshot, {
			rowId: options?.rowId,
			preserveCellIds: options?.preserveCellIds,
		});
		return clonedRow;
	}

	moveTableRow(
		tableContent: CRDTUnknownArray<CRDTUnknownMap>,
		rowIndex: number,
		targetIndex: number,
	): boolean {
		const rowMap = tableContent.get(rowIndex);
		if (!rowMap || !isCRDTMap(rowMap)) {
			return false;
		}

		const nextIndex = Math.max(
			0,
			Math.min(targetIndex, tableContent.length - 1),
		);
		if (nextIndex === rowIndex) {
			return true;
		}

		const movedRow = this.cloneTableRow(rowMap, {
			preserveCellIds: true,
		});
		tableContent.delete(rowIndex, 1);
		tableContent.insert(nextIndex, [movedRow]);
		return true;
	}

	captureTableRowSnapshot(sourceRow: CRDTUnknownMap): TableRowSnapshot {
		return captureTableRowSnapshot(sourceRow);
	}

	applyTableRowSnapshot(
		targetRow: CRDTUnknownMap,
		snapshot: TableRowSnapshot,
		options?: {
			rowId?: string;
			preserveCellIds?: boolean;
		},
	): void {
		const nextRowId = options?.rowId ?? snapshot.rowId;
		if (nextRowId) {
			targetRow.set("id", nextRowId);
		}

		const targetCells = getRowCells(targetRow);
		if (!targetCells) {
			return;
		}

		for (
			let columnIndex = 0;
			columnIndex < snapshot.cells.length;
			columnIndex++
		) {
			const targetCell = targetCells.get(columnIndex);
			const cellSnapshot = snapshot.cells[columnIndex];
			if (!targetCell || !cellSnapshot || !isCRDTMap(targetCell)) {
				continue;
			}

			if (options?.preserveCellIds && cellSnapshot.cellId) {
				targetCell.set("id", cellSnapshot.cellId);
			}

			writeCellDeltas(targetCell, cellSnapshot.deltas);
		}
	}

	resolveGridColumnCount(blockMap: CRDTUnknownMap): number {
		const tableColumns = getTableColumns(blockMap);
		if (tableColumns && tableColumns.length > 0) {
			return tableColumns.length;
		}
		const tableContent = getTableContent(blockMap);
		if (tableContent && tableContent.length > 0) {
			let maxColumnCount = 0;
			forEachRowCells(tableContent, (cells) => {
				maxColumnCount = Math.max(maxColumnCount, cells.length);
			});
			if (maxColumnCount > 0) {
				return maxColumnCount;
			}
		}
		return 1;
	}

	setStructuredTableColumns(
		blockMap: CRDTUnknownMap,
		columns: Array<TableColumnSchema | Record<string, unknown>>,
	): void {
		const tableColumns =
			this._adapter.createArray() as CRDTUnknownArray<CRDTUnknownMap>;
		tableColumns.insert(
			0,
			columns.map((column) => this.createTableColumnMap(column)),
		);
		blockMap.set("tableColumns", tableColumns);
	}

	createTableColumnMap(
		column: TableColumnSchema | Record<string, unknown>,
	): CRDTUnknownMap {
		const columnMap = this._adapter.createMap() as CRDTUnknownMap;
		for (const [key, value] of Object.entries(
			column as Record<string, unknown>,
		)) {
			if (value === undefined) {
				continue;
			}
			if (key === "options" && Array.isArray(value)) {
				const optionsArray =
					this._adapter.createArray() as CRDTUnknownArray<CRDTUnknownMap>;
				optionsArray.insert(
					0,
					value.map((option) =>
						createRecordMap(
							() => this._adapter.createMap() as CRDTUnknownMap,
							option as Record<string, unknown>,
						),
					),
				);
				columnMap.set(key, optionsArray);
				continue;
			}
			if (key === "format" && value && typeof value === "object") {
				columnMap.set(
					key,
					createRecordMap(
						() => this._adapter.createMap() as CRDTUnknownMap,
						value as Record<string, unknown>,
					),
				);
				continue;
			}
			columnMap.set(key, value);
		}
		return columnMap;
	}

	setColumnValue(
		columnMap: CRDTUnknownMap,
		key: string,
		value: unknown,
	): void {
		if (key === "id") {
			return;
		}
		if (value === undefined || value === null) {
			columnMap.delete?.(key);
			return;
		}
		if (key === "options" && Array.isArray(value)) {
			const optionsArray =
				this._adapter.createArray() as CRDTUnknownArray<CRDTUnknownMap>;
			if (value.length > 0) {
				optionsArray.insert(
					0,
					value.map((option: unknown) =>
						createRecordMap(
							() => this._adapter.createMap() as CRDTUnknownMap,
							option as Record<string, unknown>,
						),
					),
				);
			}
			columnMap.set(key, optionsArray);
			return;
		}
		if (key === "format" && value && typeof value === "object") {
			columnMap.set(
				key,
				createRecordMap(
					() => this._adapter.createMap() as CRDTUnknownMap,
					value as Record<string, unknown>,
				),
			);
			return;
		}
		columnMap.set(key, value);
	}

	readColumnIds(
		tableColumns: CRDTUnknownArray<CRDTUnknownMap> | null,
	): string[] {
		if (!tableColumns) {
			return [];
		}
		const ids: string[] = [];
		for (let index = 0; index < tableColumns.length; index++) {
			const column = tableColumns.get(index);
			if (!column || !isCRDTMap(column)) {
				continue;
			}
			const id = getStringProp(column, "id");
			if (id) {
				ids.push(id);
			}
		}
		return ids;
	}
}

/** Calls `visit` with each row's cell array, skipping malformed rows. */
function forEachRowCells(
	tableContent: TableContentArray,
	visit: (cells: CRDTUnknownArray<TableCellMap>) => void,
): void {
	for (let rowIndex = 0; rowIndex < tableContent.length; rowIndex++) {
		const row = tableContent.get(rowIndex);
		if (!row || !isCRDTMap(row)) {
			continue;
		}
		const cells = getRowCells(row);
		if (cells) {
			visit(cells);
		}
	}
}
