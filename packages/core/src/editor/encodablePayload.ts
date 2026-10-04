// Op payload values land in the CRDT verbatim. A value the CRDT cannot
// encode is accepted at write time and only fails when the document is next
// encoded, at which point the whole document can no longer sync or persist.
// The validate phase rejects such values up front (OPB1).

/**
 * Whether `value` can be stored as a map value: any acyclic structure.
 * Map values are binary-encoded by walking arrays and object keys, so a
 * cycle recurses without bound at encode time.
 */
export function isStorableMapValue(value: unknown): boolean {
	return walk(value, false);
}

/**
 * Whether `value` can be stored as a text attribute or embed. Text marks and
 * inline atoms are JSON-encoded, so a top-level `undefined`, function, or
 * symbol, and a bigint or cycle anywhere, fail at encode time.
 */
export function isJsonEncodable(value: unknown): boolean {
	const kind = typeof value;
	if (kind === "undefined" || kind === "function" || kind === "symbol") {
		return false;
	}
	return walk(value, true);
}

function walk(value: unknown, json: boolean): boolean {
	try {
		return isEncodableNode(value, json, new Set());
	} catch {
		// Nesting deep enough to exhaust the stack here would exhaust it at
		// encode time too.
		return false;
	}
}

function isEncodableNode(
	value: unknown,
	json: boolean,
	ancestors: Set<object>,
): boolean {
	if (typeof value === "bigint") {
		return !json;
	}
	if (value === null || typeof value !== "object") {
		return true;
	}
	if (ArrayBuffer.isView(value)) {
		return true;
	}
	if (ancestors.has(value)) {
		return false;
	}
	ancestors.add(value);
	const children = Array.isArray(value)
		? value
		: Object.values(value as Record<string, unknown>);
	for (const child of children) {
		if (!isEncodableNode(child, json, ancestors)) {
			return false;
		}
	}
	ancestors.delete(value);
	return true;
}
