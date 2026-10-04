import type { BlockSchema, Editor } from "@input/pen-types";
import type { PenBlock } from "./clipboardPayload";

/**
 * SEC4 / IOP5 clipboard caps. Same numbers as JSON/HTML/Markdown ingest.
 */
export const CLIPBOARD_INGEST_MAX_NESTING_DEPTH = 32;
export const CLIPBOARD_INGEST_MAX_NODE_COUNT = 10_000;
export const CLIPBOARD_INGEST_MAX_TEXT_SIZE = 1_048_576;
export const CLIPBOARD_INGEST_MAX_IMAGE_COUNT = 256;

/**
 * Advisory IOP5 wall-clock ceiling for one clipboard ingest. Same number
 * as the HTML/markdown `INGEST_TIME_BUDGET_MS`. Not a unit-suite gate —
 * the suite pins the four cardinality caps, which is why a 10k-node
 * paste finishes. Record timing in `@input/pen-bench` if the clock
 * itself needs a home.
 */
export const CLIPBOARD_INGEST_TIME_BUDGET_MS = 1_000;

export type ClipboardIngestDropReason =
	| "unknown-block-type"
	| "invalid-props"
	| "forbidden-key"
	| "depth-exceeded"
	| "count-exceeded"
	| "text-size-exceeded"
	| "image-count-exceeded";

const FORBIDDEN_OWN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface ClipboardIngestDrop {
	readonly reason: ClipboardIngestDropReason;
	readonly count: number;
	readonly bound?: string;
}

export interface ClipboardIngestResult {
	readonly blocks: PenBlock[];
	readonly droppedByReason: readonly ClipboardIngestDrop[];
}

const BOUND_BY_REASON: Partial<Record<ClipboardIngestDropReason, string>> = {
	"depth-exceeded": "CLIPBOARD_INGEST_MAX_NESTING_DEPTH",
	"count-exceeded": "CLIPBOARD_INGEST_MAX_NODE_COUNT",
	"text-size-exceeded": "CLIPBOARD_INGEST_MAX_TEXT_SIZE",
	"image-count-exceeded": "CLIPBOARD_INGEST_MAX_IMAGE_COUNT",
};

export function admitClipboardBlocks(
	blocks: readonly PenBlock[],
	editor: Editor,
): ClipboardIngestResult {
	const counts = new Map<ClipboardIngestDropReason, number>();
	const state = { nodes: 0, text: 0, images: 0 };
	const admitted: PenBlock[] = [];

	for (const block of blocks) {
		const next = admitBlock(block, 1, editor, state, counts);
		if (next) {
			admitted.push(next);
		}
	}

	return {
		blocks: admitted,
		droppedByReason: [...counts.entries()]
			.sort(([left], [right]) => left.localeCompare(right, "en"))
			.map(([reason, count]) => {
				const bound = BOUND_BY_REASON[reason];
				const drop: ClipboardIngestDrop = { reason, count };
				return bound ? { ...drop, bound } : drop;
			}),
	};
}

/** IOP5: bound literal recovery before allocating blocks or replacing selection. */
export function admitClipboardPlainText(
	text: string,
	blockType: string,
	editor: Editor,
): ClipboardIngestResult {
	const drops: ClipboardIngestDrop[] = [];
	let source = text;
	if (source.length > CLIPBOARD_INGEST_MAX_TEXT_SIZE) {
		source = source.slice(0, CLIPBOARD_INGEST_MAX_TEXT_SIZE);
		const boundary = source.lastIndexOf("\n");
		if (boundary > 0) source = source.slice(0, boundary).replace(/\r$/, "");
		drops.push({
			reason: "text-size-exceeded",
			count: 1,
			bound: "CLIPBOARD_INGEST_MAX_TEXT_SIZE",
		});
	}
	const lines = source.split(/\r?\n/);
	if (lines.length > CLIPBOARD_INGEST_MAX_NODE_COUNT) {
		drops.push({
			reason: "count-exceeded",
			count: lines.length - CLIPBOARD_INGEST_MAX_NODE_COUNT,
			bound: "CLIPBOARD_INGEST_MAX_NODE_COUNT",
		});
		lines.length = CLIPBOARD_INGEST_MAX_NODE_COUNT;
	}
	const admitted = admitClipboardBlocks(
		lines.map((content) => ({ type: blockType, props: {}, content })),
		editor,
	);
	return {
		blocks: admitted.blocks,
		droppedByReason: [...drops, ...admitted.droppedByReason],
	};
}

export function withForbiddenKeyDrops(
	report: ClipboardIngestResult,
	forbiddenKeyCount: number,
): ClipboardIngestResult {
	if (forbiddenKeyCount <= 0) {
		return report;
	}

	const droppedByReason = [
		...report.droppedByReason.filter(
			(entry) => entry.reason !== "forbidden-key",
		),
		{ reason: "forbidden-key" as const, count: forbiddenKeyCount },
	].sort((left, right) => left.reason.localeCompare(right.reason, "en"));

	return { blocks: report.blocks, droppedByReason };
}

export function emitClipboardIngestReport(
	editor: Pick<Editor, "internals">,
	report: ClipboardIngestResult,
): void {
	if (report.droppedByReason.length === 0) {
		return;
	}

	const truncated = report.droppedByReason.some((entry) => entry.bound);
	editor.internals.emit("diagnostic", {
		code: truncated ? "import-truncated" : "import-dropped",
		level: "warn",
		source: "clipboard",
		message: truncated
			? "clipboard import truncated"
			: "clipboard import dropped",
		droppedByReason: report.droppedByReason,
	});
}

function admitBlock(
	block: PenBlock,
	depth: number,
	editor: Editor,
	state: { nodes: number; text: number; images: number },
	counts: Map<ClipboardIngestDropReason, number>,
): PenBlock | null {
	if (depth > CLIPBOARD_INGEST_MAX_NESTING_DEPTH) {
		addDrop(counts, "depth-exceeded");
		return null;
	}
	if (state.nodes >= CLIPBOARD_INGEST_MAX_NODE_COUNT) {
		addDrop(counts, "count-exceeded");
		return null;
	}

	const type = block.type;
	if (typeof type !== "string" || type.length === 0) {
		addDrop(counts, "invalid-props");
		return null;
	}

	const isInternal = type.startsWith("__table");
	const registered = isInternal
		? true
		: editor.schema.allBlocks().some((schema) => schema.type === type);
	if (!registered) {
		addDrop(counts, "unknown-block-type");
		return null;
	}

	if (type === "image" && state.images >= CLIPBOARD_INGEST_MAX_IMAGE_COUNT) {
		addDrop(counts, "image-count-exceeded");
		return null;
	}

	const textLength = clipboardTextLength(block);
	if (state.text + textLength > CLIPBOARD_INGEST_MAX_TEXT_SIZE) {
		addDrop(counts, "text-size-exceeded");
		return null;
	}

	const schema = isInternal ? null : (editor.schema.resolve(type) ?? null);
	const { props, unknownCount } = admitProps(schema, block.props);
	if (unknownCount > 0) {
		addDrop(counts, "invalid-props", unknownCount);
	}

	state.nodes += 1;
	state.text += textLength;
	if (type === "image") {
		state.images += 1;
	}

	const children: PenBlock[] = [];
	if (Array.isArray(block.children)) {
		for (const child of block.children) {
			const admitted = admitBlock(
				child,
				depth + 1,
				editor,
				state,
				counts,
			);
			if (admitted) {
				children.push(admitted);
			}
		}
	}

	const next: PenBlock = { type, props };
	if (typeof block.content === "string") {
		next.content = block.content;
	}
	if (Array.isArray(block.deltas)) {
		next.deltas = admitDeltas(block.deltas);
	}
	if (children.length > 0) {
		next.children = children;
	}
	if (block.isPartial) {
		next.isPartial = true;
	}
	return next;
}

function admitProps(
	schema: Pick<BlockSchema, "propSchema" | "validateProps"> | null,
	raw: Record<string, unknown> | undefined,
): { props: Record<string, unknown>; unknownCount: number } {
	const source = raw ?? emptyRecord();
	if (!schema) {
		return { props: copyOwn(source), unknownCount: 0 };
	}

	let unknownCount = 0;
	const known = emptyRecord();
	for (const key of Object.keys(source)) {
		if (FORBIDDEN_OWN_KEYS.has(key)) {
			continue;
		}
		if (key in schema.propSchema) {
			known[key] = source[key];
		} else {
			unknownCount += 1;
		}
	}

	const validated = schema.validateProps
		? schema.validateProps(known)
		: known;
	return { props: copyOwn(validated), unknownCount };
}

function admitDeltas(
	deltas: NonNullable<PenBlock["deltas"]>,
): NonNullable<PenBlock["deltas"]> {
	return deltas.map((delta) => {
		const next: NonNullable<PenBlock["deltas"]>[number] = {
			insert: delta.insert,
		};
		if (delta.attributes) {
			next.attributes = copyOwn(delta.attributes);
		}
		return next;
	});
}

function clipboardTextLength(block: PenBlock): number {
	if (Array.isArray(block.deltas) && block.deltas.length > 0) {
		let length = 0;
		for (const delta of block.deltas) {
			if (typeof delta.insert === "string") {
				length += delta.insert.length;
			}
		}
		return length;
	}
	return typeof block.content === "string" ? block.content.length : 0;
}

function addDrop(
	counts: Map<ClipboardIngestDropReason, number>,
	reason: ClipboardIngestDropReason,
	count = 1,
): void {
	counts.set(reason, (counts.get(reason) ?? 0) + count);
}

function emptyRecord(): Record<string, unknown> {
	return Object.create(null) as Record<string, unknown>;
}

function copyOwn(source: Record<string, unknown>): Record<string, unknown> {
	const record = emptyRecord();
	for (const key of Object.keys(source)) {
		if (FORBIDDEN_OWN_KEYS.has(key)) {
			continue;
		}
		record[key] = source[key];
	}
	return record;
}
