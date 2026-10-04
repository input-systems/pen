import type { Editor } from "@input/pen-types";
import { INGEST_FORBIDDEN_KEYS, INGEST_MAX_TEXT_SIZE } from "../../ingestBounds";
import {
	emitIngestReport as emitSharedIngestReport,
	type IngestDropCounts,
	type IngestReport,
} from "../../ingestReport";

export {
	INGEST_FORBIDDEN_KEYS,
	INGEST_MAX_IMAGE_COUNT,
	INGEST_MAX_NESTING_DEPTH,
	INGEST_MAX_NODE_COUNT,
	INGEST_MAX_TEXT_SIZE,
	INGEST_TIME_BUDGET_MS,
} from "../../ingestBounds";
export {
	createIngestReport,
	IngestDropCounts,
	type IngestDropReason,
	type IngestDroppedByReason,
	type IngestReport,
} from "../../ingestReport";

/**
 * Refuse a JSON source that exceeds the text cap. Slicing would produce
 * invalid JSON, so parse never runs on the oversize string.
 */
export function capRawJsonSource(
	input: string,
	drops: IngestDropCounts,
): string | null {
	if (input.length <= INGEST_MAX_TEXT_SIZE) {
		return input;
	}
	drops.add(
		"text-size-exceeded",
		input.length - INGEST_MAX_TEXT_SIZE,
		input.length,
	);
	return null;
}

export function parseJsonSource(source: string): unknown {
	if (source.length > INGEST_MAX_TEXT_SIZE) {
		throw new Error(
			`JSON parse received ${source.length} code units; INGEST_MAX_TEXT_SIZE is ${INGEST_MAX_TEXT_SIZE}`,
		);
	}
	return JSON.parse(source);
}

/** JSON's diagnostic message names the bound but not its measured values. */
export function emitIngestReport(
	editor: Pick<Editor, "internals">,
	report: IngestReport,
	source: string,
): void {
	emitSharedIngestReport(editor, report, source, false);
}

function isForbiddenKey(key: string): boolean {
	return (
		key === "__proto__" || key === "constructor" || key === "prototype"
	);
}

export function emptyRecord(): Record<string, unknown> {
	return Object.create(null) as Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fresh null-prototype copy. Never deep-merges raw parsed JSON into an
 * existing object. `__proto__` / `constructor` / `prototype` own keys are
 * rejected anywhere in the tree (SEC4).
 */
function copyJsonValue(
	value: unknown,
	drops: IngestDropCounts,
): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => copyJsonValue(item, drops));
	}
	return copyRecord(value, drops);
}

export function copyRecord(
	source: object,
	drops: IngestDropCounts,
): Record<string, unknown> {
	const record = emptyRecord();
	for (const key of INGEST_FORBIDDEN_KEYS) {
		if (Object.prototype.hasOwnProperty.call(source, key)) {
			drops.add("forbidden-key");
		}
	}
	for (const key of Object.keys(source)) {
		if (isForbiddenKey(key)) {
			continue;
		}
		record[key] = copyJsonValue(
			(source as Record<string, unknown>)[key],
			drops,
		);
	}
	return record;
}
