import type { PenDocument } from "@input/pen-types";
import type { Peer, TestEditor, TwoPeer } from "./types";

export type InspectSource = TestEditor | TwoPeer | Peer | PenDocument;

type BlockMapLike = {
	get(key: string): unknown;
};

type PropMapLike = {
	get(key: string): unknown;
};

type ChildrenArrayLike = {
	readonly length: number;
	get(index: number): string;
};

type TextLike = {
	toString(): string;
};

export function listBlockIds(source: InspectSource): string[] {
	const doc = asDocument(source);
	const seen = new Set<string>();
	const ids: string[] = [];

	for (let i = 0; i < doc.blockOrder.length; i++) {
		const id = doc.blockOrder.get(i);
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		ids.push(id);
	}

	const extras: string[] = [];
	for (const id of doc.blocks.keys()) {
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		extras.push(id);
	}
	extras.sort((left, right) => left.localeCompare(right));
	return ids.concat(extras);
}

export function getParentId(
	source: InspectSource,
	blockId: string,
): string | null {
	const fromProp = readParentIdProp(source, blockId);
	if (fromProp) {
		return fromProp;
	}

	for (const candidateId of listBlockIds(source)) {
		if (readChildrenIds(source, candidateId).includes(blockId)) {
			return candidateId;
		}
	}

	return null;
}

export function getChildrenIds(
	source: InspectSource,
	blockId: string,
): string[] {
	const seen = new Set<string>();
	const ids: string[] = [];

	for (const childId of readChildrenIds(source, blockId)) {
		if (seen.has(childId)) {
			continue;
		}
		seen.add(childId);
		ids.push(childId);
	}

	for (const candidateId of listBlockIds(source)) {
		if (readParentIdProp(source, candidateId) !== blockId) {
			continue;
		}
		if (seen.has(candidateId)) {
			continue;
		}
		seen.add(candidateId);
		ids.push(candidateId);
	}

	return ids;
}

export function parentsOf(
	source: InspectSource,
	blockId: string,
): string[] {
	const parents: string[] = [];
	const seen = new Set<string>();

	const fromProp = readParentIdProp(source, blockId);
	if (fromProp) {
		seen.add(fromProp);
		parents.push(fromProp);
	}

	for (const candidateId of listBlockIds(source)) {
		if (!readChildrenIds(source, candidateId).includes(blockId)) {
			continue;
		}
		if (seen.has(candidateId)) {
			continue;
		}
		seen.add(candidateId);
		parents.push(candidateId);
	}

	return parents;
}

export function countMemberships(
	source: InspectSource,
	blockId: string,
): number {
	const doc = asDocument(source);
	let count = 0;

	for (let i = 0; i < doc.blockOrder.length; i++) {
		if (doc.blockOrder.get(i) === blockId) {
			count += 1;
		}
	}

	for (const candidateId of listBlockIds(source)) {
		for (const childId of readChildrenIds(source, candidateId)) {
			if (childId === blockId) {
				count += 1;
			}
		}
	}

	return count;
}

export function findParentCycle(
	source: InspectSource,
	startId?: string,
): string[] | null {
	const starts = startId ? [startId] : listBlockIds(source);
	for (const start of starts) {
		const cycle = walkParentCycle(source, start);
		if (cycle) {
			return cycle;
		}
	}
	return null;
}

export function hasParentCycle(
	source: InspectSource,
	startId?: string,
): boolean {
	return findParentCycle(source, startId) !== null;
}

export function collectInlineText(source: InspectSource): string[] {
	const texts: string[] = [];
	for (const blockId of listBlockIds(source)) {
		const text = readInlineText(source, blockId);
		if (text === null) {
			continue;
		}
		texts.push(text);
	}
	return texts;
}

export function concatenatedInlineText(source: InspectSource): string {
	return collectInlineText(source).join("");
}

export function visibleText(text: string): string;
export function visibleText(source: InspectSource, blockId?: string): string;
export function visibleText(
	sourceOrText: InspectSource | string,
	blockId?: string,
): string {
	if (typeof sourceOrText === "string") {
		return sourceOrText;
	}
	if (blockId) {
		return readInlineText(sourceOrText, blockId) ?? "";
	}
	return concatenatedInlineText(sourceOrText);
}

export function countEmptyInlineBlocks(source: InspectSource): number {
	let count = 0;
	for (const blockId of listBlockIds(source)) {
		const text = readInlineText(source, blockId);
		if (text === "") {
			count += 1;
		}
	}
	return count;
}

/**
 * The `PenDocument` behind any inspect source. Not on the barrel.
 *
 * @internal
 */
export function asInspectDocument(source: InspectSource): PenDocument {
	return asDocument(source);
}

function asDocument(source: InspectSource): PenDocument {
	if (isPeer(source)) {
		return source.editor.document;
	}
	if (isPenDocument(source)) {
		return source;
	}
	return source.document;
}

function isPeer(source: InspectSource): source is TwoPeer | Peer {
	return "editor" in source && "adapter" in source && "crdtDoc" in source;
}

function isPenDocument(source: InspectSource): source is PenDocument {
	return (
		"blockOrder" in source &&
		"blocks" in source &&
		!("document" in source) &&
		!("editor" in source)
	);
}

function getBlockMap(
	source: InspectSource,
	blockId: string,
): BlockMapLike | null {
	const raw = asDocument(source).blocks.get(blockId);
	if (!isBlockMap(raw)) {
		return null;
	}
	return raw;
}

function readParentIdProp(
	source: InspectSource,
	blockId: string,
): string | null {
	const blockMap = getBlockMap(source, blockId);
	if (!blockMap) {
		return null;
	}
	const props = blockMap.get("props");
	if (!isPropMap(props)) {
		return null;
	}
	const parentId = props.get("parentId");
	return typeof parentId === "string" && parentId.length > 0 ? parentId : null;
}

function readChildrenIds(source: InspectSource, blockId: string): string[] {
	const blockMap = getBlockMap(source, blockId);
	if (!blockMap) {
		return [];
	}
	const children = blockMap.get("children");
	if (!isChildrenArray(children)) {
		return [];
	}
	const ids: string[] = [];
	for (let i = 0; i < children.length; i++) {
		ids.push(children.get(i));
	}
	return ids;
}

function readInlineText(
	source: InspectSource,
	blockId: string,
): string | null {
	const blockMap = getBlockMap(source, blockId);
	if (!blockMap) {
		return null;
	}
	const content = blockMap.get("content");
	if (!isTextLike(content)) {
		return null;
	}
	return content.toString();
}

function walkParentCycle(
	source: InspectSource,
	startId: string,
): string[] | null {
	const seen: string[] = [];
	const seenSet = new Set<string>();
	let current: string | null = startId;

	while (current) {
		if (seenSet.has(current)) {
			const start = seen.indexOf(current);
			return [...seen.slice(start), current];
		}
		if (!getBlockMap(source, current)) {
			return null;
		}
		seen.push(current);
		seenSet.add(current);
		current = getParentId(source, current);
	}

	return null;
}

function isBlockMap(value: unknown): value is BlockMapLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as BlockMapLike).get === "function"
	);
}

function isPropMap(value: unknown): value is PropMapLike {
	return isBlockMap(value);
}

function isChildrenArray(value: unknown): value is ChildrenArrayLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as ChildrenArrayLike).length === "number" &&
		typeof (value as ChildrenArrayLike).get === "function"
	);
}

function isTextLike(value: unknown): value is TextLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as TextLike).toString === "function" &&
		typeof (value as { insert?: unknown }).insert === "function"
	);
}
