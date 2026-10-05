/**
 * Duck-typed reads of stored block maps and arrays, shared by the full
 * block-index build and its incremental advance.
 */

export function asMap(value: unknown): { get(key: string): unknown } | null {
	if (
		value != null &&
		typeof value === "object" &&
		typeof (value as { get?: unknown }).get === "function"
	) {
		return value as { get(key: string): unknown };
	}
	return null;
}

export function storedText(value: unknown): string {
	if (
		value != null &&
		typeof value === "object" &&
		typeof (value as { toString?: unknown }).toString === "function"
	) {
		return String((value as { toString: () => string }).toString());
	}
	return "";
}

export function readStringArray(value: unknown): string[] {
	if (value == null || typeof value !== "object") return [];
	const arr = value as {
		length?: number;
		get?: (index: number) => unknown;
		toArray?: () => unknown[];
	};
	if (typeof arr.toArray === "function") {
		return arr
			.toArray()
			.filter((id): id is string => typeof id === "string");
	}
	if (typeof arr.length === "number" && typeof arr.get === "function") {
		const out: string[] = [];
		for (let i = 0; i < arr.length; i++) {
			const id = arr.get(i);
			if (typeof id === "string") out.push(id);
		}
		return out;
	}
	return [];
}
