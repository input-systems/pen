// Op payload values land in the CRDT verbatim. A value the CRDT cannot
// store throws partway through the op's writes, which the CRDT cannot roll
// back; a value it stores but encodes lossily leaves peers with different
// documents; a cycle is accepted at write time and only fails when the
// document is next encoded, at which point it can no longer sync or persist.
// The validate phase rejects all of them up front (OPB1).

/**
 * Whether `value` can be stored as a map value: acyclic plain data —
 * strings, numbers, booleans, `null`, `undefined`, `Uint8Array`, and arrays
 * and plain objects of those. The CRDT refuses any other class at the top
 * level, and below it encodes a class instance by its own keys, so a `Date`
 * or `Map` reaches other peers as `{}`. A bigint is refused because block
 * props and meta are read back as JSON.
 */
export function isStorableMapValue(value: unknown): boolean {
	if (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		!(value instanceof Uint8Array) &&
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		// The CRDT picks a map value's encoding by its constructor, which a
		// null-prototype object lacks.
		return false;
	}
	return walk(value, false);
}

/**
 * Whether `value` can be stored as a text attribute or embed. Text marks and
 * inline atoms are JSON-encoded, so a top-level `undefined` fails at encode
 * time, and a non-finite number or a `Uint8Array` reaches other peers as
 * `null` or an index-keyed object.
 */
export function isJsonEncodable(value: unknown): boolean {
	if (value === undefined) {
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
	if (value === null || typeof value !== "object") {
		return isEncodableLeaf(value, json);
	}
	if (value instanceof Uint8Array) {
		return !json;
	}
	if (!isPlainContainer(value) || ancestors.has(value)) {
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

/** A primitive: bigints, functions and symbols are refused (see above). */
function isEncodableLeaf(value: unknown, json: boolean): boolean {
	switch (typeof value) {
		case "string":
		case "boolean":
		case "undefined":
			return true;
		case "number":
			return !json || Number.isFinite(value);
		default:
			return value === null;
	}
}

/** An array or an object of plain (or null) prototype, not a class instance. */
function isPlainContainer(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return (
		prototype === Array.prototype ||
		prototype === Object.prototype ||
		prototype === null
	);
}
