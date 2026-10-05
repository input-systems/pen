import type { PenDocument } from "@input/pen-types";
import {
	asInspectDocument,
	findParentCycle,
	type InspectSource,
} from "./twoPeerInspect";

/** The structural array an entry lives in: the root order, or a block's `children`. */
export type StructuralArray = "blockOrder" | { readonly children: string };

/**
 * One COL4 structural invariant breach. Membership counts `blockOrder` and
 * `children` entries; `parentId` props do not count.
 */
export type StructuralViolation =
	| { readonly kind: "cycle"; readonly blockIds: readonly string[] }
	| {
			readonly kind: "duplicate-entry";
			readonly array: StructuralArray;
			readonly blockId: string;
			readonly count: number;
	  }
	| {
			readonly kind: "dangling-entry";
			readonly array: StructuralArray;
			readonly blockId: string;
	  }
	| { readonly kind: "orphan"; readonly blockId: string }
	| {
			readonly kind: "cross-array";
			readonly blockId: string;
			readonly memberships: number;
	  };

type ArrayLike = {
	readonly length: number;
	get(index: number): unknown;
};

type MapLike = {
	get(key: string): unknown;
};

type StructuralEntries = {
	readonly array: StructuralArray;
	readonly ids: readonly string[];
};

/**
 * Every COL4 structural violation in the document: parent cycles, duplicate
 * entries in one array, entries naming no live block map (dangling), block
 * maps with zero memberships (orphans), and block maps that are members of
 * more than one array (cross-array). A clean document returns `[]`.
 */
export function findStructuralViolations(
	source: InspectSource,
): StructuralViolation[] {
	const doc = asInspectDocument(source);
	const liveIds = new Set<string>(doc.blocks.keys());
	const arrays = readStructuralArrays(doc);
	const violations: StructuralViolation[] = [];
	const membershipCount = new Map<string, number>();
	const membershipArrays = new Map<string, number>();

	for (const { array, ids } of arrays) {
		const counts = new Map<string, number>();
		for (const id of ids) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		for (const [blockId, count] of counts) {
			if (!liveIds.has(blockId)) {
				violations.push({ kind: "dangling-entry", array, blockId });
				continue;
			}
			if (count > 1) {
				violations.push({ kind: "duplicate-entry", array, blockId, count });
			}
			membershipCount.set(blockId, (membershipCount.get(blockId) ?? 0) + count);
			membershipArrays.set(blockId, (membershipArrays.get(blockId) ?? 0) + 1);
		}
	}

	for (const blockId of [...liveIds].sort()) {
		const memberships = membershipCount.get(blockId) ?? 0;
		if (memberships === 0) {
			violations.push({ kind: "orphan", blockId });
			continue;
		}
		if ((membershipArrays.get(blockId) ?? 0) > 1) {
			violations.push({ kind: "cross-array", blockId, memberships });
		}
	}

	const seenCycles = new Set<string>();
	for (const blockId of [...liveIds].sort()) {
		const cycle = findParentCycle(source, blockId);
		if (!cycle) continue;
		const members = [...new Set(cycle)].sort();
		const key = members.join("\u0000");
		if (seenCycles.has(key)) continue;
		seenCycles.add(key);
		violations.push({ kind: "cycle", blockIds: members });
	}

	return violations;
}

/**
 * Throws listing every structural violation `findStructuralViolations` finds;
 * `message` prefixes the error. The COL4 oracle.
 */
export function assertStructuralInvariants(
	source: InspectSource,
	message?: string,
): void {
	const violations = findStructuralViolations(source);
	if (violations.length === 0) {
		return;
	}
	const detail = message ? `${message}\n` : "";
	throw new Error(
		`${detail}Structural invariants violated (${violations.length}):\n${violations.map(describeViolation).join("\n")}`,
	);
}

function describeViolation(violation: StructuralViolation): string {
	switch (violation.kind) {
		case "cycle":
			return `- cycle: ${violation.blockIds.join(" -> ")}`;
		case "duplicate-entry":
			return `- duplicate-entry: "${violation.blockId}" appears ${violation.count} times in ${describeArray(violation.array)}`;
		case "dangling-entry":
			return `- dangling-entry: "${violation.blockId}" in ${describeArray(violation.array)} has no block map`;
		case "orphan":
			return `- orphan: "${violation.blockId}" is in no blockOrder or children array`;
		case "cross-array":
			return `- cross-array: "${violation.blockId}" has ${violation.memberships} memberships across arrays`;
		default: {
			const _never: never = violation;
			throw new Error(`Unknown structural violation: ${JSON.stringify(_never)}`);
		}
	}
}

function describeArray(array: StructuralArray): string {
	return array === "blockOrder" ? "blockOrder" : `children of "${array.children}"`;
}

function readStructuralArrays(doc: PenDocument): StructuralEntries[] {
	const arrays: StructuralEntries[] = [
		{ array: "blockOrder", ids: readIds(doc.blockOrder as unknown as ArrayLike) },
	];
	const parentIds = [...doc.blocks.keys()].sort();
	for (const parentId of parentIds) {
		const blockMap = doc.blocks.get(parentId) as unknown;
		if (!isMapLike(blockMap)) continue;
		const children = blockMap.get("children");
		if (!isArrayLike(children)) continue;
		arrays.push({ array: { children: parentId }, ids: readIds(children) });
	}
	return arrays;
}

function readIds(array: ArrayLike): string[] {
	const ids: string[] = [];
	for (let i = 0; i < array.length; i++) {
		const id = array.get(i);
		if (typeof id === "string") {
			ids.push(id);
		}
	}
	return ids;
}

function isMapLike(value: unknown): value is MapLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as MapLike).get === "function"
	);
}

function isArrayLike(value: unknown): value is ArrayLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as ArrayLike).length === "number" &&
		typeof (value as ArrayLike).get === "function"
	);
}
