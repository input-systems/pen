export interface CRDTTextLike {
	insert(
		offset: number,
		text: string,
		attributes?: Record<string, unknown | null>,
	): void;
	delete(offset: number, length: number): void;
	format(
		offset: number,
		length: number,
		attributes: Record<string, unknown>,
	): void;
	toDelta?(): Array<{
		insert: string | Record<string, unknown>;
		attributes?: Record<string, unknown>;
	}>;
	toString(): string;
	readonly length: number;
}

export interface CRDTInlineTextLike extends CRDTTextLike {
	insertEmbed(offset: number, value: Record<string, unknown>): void;
}

export interface CRDTUnknownArray<T = unknown> {
	readonly length: number;
	get(index: number): T;
	toArray?(): T[];
	insert(index: number, values: T[]): void;
	delete(index: number, length: number): void;
	[Symbol.iterator]?(): Iterator<T>;
}

export interface CRDTUnknownMap<T = unknown> {
	get(key: string): T | undefined;
	has?(key: string): boolean;
	entries?(): IterableIterator<[string, T]>;
	keys?(): IterableIterator<string>;
	readonly size?: number;
	set(key: string, value: unknown): void;
	delete?(key: string): void;
}

export type TableCellMap = CRDTUnknownMap;
export type TableRowMap = CRDTUnknownMap;
export type TableContentArray = CRDTUnknownArray<TableRowMap>;
export type TableColumnMap = CRDTUnknownMap;
export type TableColumnArray = CRDTUnknownArray<TableColumnMap>;

function isCRDTArray(value: unknown): value is CRDTUnknownArray {
	return (
		typeof value === "object" &&
		value !== null &&
		"length" in value &&
		typeof (value as { get?: unknown }).get === "function" &&
		typeof (value as { insert?: unknown }).insert === "function" &&
		typeof (value as { delete?: unknown }).delete === "function"
	);
}

export function isCRDTMap(value: unknown): value is CRDTUnknownMap {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { get?: unknown }).get === "function" &&
		typeof (value as { set?: unknown }).set === "function"
	);
}

export function getArrayProp<T = unknown>(
	map: CRDTUnknownMap,
	key: string,
): CRDTUnknownArray<T> | null {
	const value = map.get(key);
	return isCRDTArray(value) ? (value as CRDTUnknownArray<T>) : null;
}

export function getMapProp(
	map: CRDTUnknownMap,
	key: string,
): CRDTUnknownMap | null {
	const value = map.get(key);
	return isCRDTMap(value) ? value : null;
}

export function getStringProp(
	map: CRDTUnknownMap,
	key: string,
): string | undefined {
	const value = map.get(key);
	return typeof value === "string" ? value : undefined;
}

export function getTextProp(
	map: CRDTUnknownMap,
	key: string,
): CRDTTextLike | null {
	const value = map.get(key);
	return typeof value === "object" &&
		value !== null &&
		typeof (value as { insert?: unknown }).insert === "function" &&
		typeof (value as { delete?: unknown }).delete === "function" &&
		typeof (value as { toString?: unknown }).toString === "function"
		? (value as CRDTTextLike)
		: null;
}

export function getTableContent(
	blockMap: CRDTUnknownMap,
): TableContentArray | null {
	return getArrayProp<TableRowMap>(blockMap, "tableContent");
}

export function getTableColumns(
	blockMap: CRDTUnknownMap,
): TableColumnArray | null {
	return getArrayProp<TableColumnMap>(blockMap, "tableColumns");
}

export function getRowCells(
	rowMap: CRDTUnknownMap,
): CRDTUnknownArray<TableCellMap> | null {
	return getArrayProp<TableCellMap>(rowMap, "cells");
}

export function getCellMap(
	rowMap: CRDTUnknownMap,
	columnIndex: number,
): TableCellMap | null {
	const cells = getRowCells(rowMap);
	if (!cells || columnIndex < 0 || columnIndex >= cells.length) {
		return null;
	}
	const cell = cells.get(columnIndex);
	return isCRDTMap(cell) ? cell : null;
}

export function getCellText(
	rowMap: CRDTUnknownMap,
	columnIndex: number,
): CRDTTextLike | null {
	const cell = getCellMap(rowMap, columnIndex);
	return cell ? getTextProp(cell, "content") : null;
}

export function crdtMapToPlainRecord(
	value: unknown,
): Record<string, unknown> | null {
	if (!value || typeof value !== "object") return null;
	const entries = (
		value as { entries?: () => IterableIterator<[string, unknown]> }
	).entries;
	if (typeof entries !== "function") {
		return value as Record<string, unknown>;
	}
	const result: Record<string, unknown> = {};
	for (const [key, entryValue] of entries.call(value)) {
		result[key] = crdtValueToPlain(entryValue);
	}
	return result;
}

export function crdtValueToPlain(value: unknown): unknown {
	if (!value || typeof value !== "object") return value;
	if (
		typeof (value as { toArray?: () => unknown[] }).toArray === "function"
	) {
		return (value as { toArray: () => unknown[] })
			.toArray()
			.map(crdtValueToPlain);
	}
	return crdtMapToPlainRecord(value);
}
