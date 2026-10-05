import type { ImportResult, Editor } from "@input/pen-types";
import {
	normalizePendingBlocksForImport,
	type PendingBlock,
} from "@input/pen-core";
import {
	INGEST_MAX_IMAGE_COUNT,
	INGEST_MAX_NESTING_DEPTH,
	INGEST_MAX_NODE_COUNT,
	INGEST_MAX_TEXT_SIZE,
} from "./ingestBounds";

/**
 * IOP5 drop accounting shared by the HTML, Markdown and JSON importers:
 * the report shape, the per-reason counter, the pending-block envelope,
 * and the `import-truncated` / `import-dropped` diagnostic.
 */

export type IngestDropReason =
	| "unknown-block-type"
	| "profile-disallowed"
	| "depth-exceeded"
	| "count-exceeded"
	| "text-size-exceeded"
	| "image-count-exceeded"
	| "invalid-props"
	| "forbidden-key";

const BOUND_BY_REASON: Partial<Record<IngestDropReason, string>> = {
	"depth-exceeded": "INGEST_MAX_NESTING_DEPTH",
	"count-exceeded": "INGEST_MAX_NODE_COUNT",
	"text-size-exceeded": "INGEST_MAX_TEXT_SIZE",
	"image-count-exceeded": "INGEST_MAX_IMAGE_COUNT",
};

const LIMIT_BY_REASON: Partial<Record<IngestDropReason, number>> = {
	"depth-exceeded": INGEST_MAX_NESTING_DEPTH,
	"count-exceeded": INGEST_MAX_NODE_COUNT,
	"text-size-exceeded": INGEST_MAX_TEXT_SIZE,
	"image-count-exceeded": INGEST_MAX_IMAGE_COUNT,
};

export interface IngestDroppedByReason {
	readonly reason: IngestDropReason;
	readonly count: number;
	readonly bound?: string;
	readonly limit?: number;
	readonly actual?: number;
	readonly dropped: string;
}

export interface IngestReport extends ImportResult {
	readonly droppedByReason: readonly IngestDroppedByReason[];
}

export class IngestDropCounts {
	private readonly counts = new Map<IngestDropReason, number>();
	private readonly actuals = new Map<IngestDropReason, number>();

	add(reason: IngestDropReason, count = 1, actual?: number): void {
		this.counts.set(reason, (this.counts.get(reason) ?? 0) + count);
		if (actual !== undefined) {
			this.actuals.set(reason, Math.max(this.actuals.get(reason) ?? 0, actual));
		}
	}

	toDroppedByReason(): IngestDroppedByReason[] {
		const reasons = [...this.counts.entries()].sort(([a], [b]) =>
			a.localeCompare(b, "en"),
		);
		return reasons.map(([reason, count]) => {
			const bound = BOUND_BY_REASON[reason];
			const limit = LIMIT_BY_REASON[reason];
			const actual = resolveActual(reason, count, this.actuals.get(reason));
			const entry: IngestDroppedByReason = {
				reason,
				count,
				dropped: formatDropped(reason, count),
			};
			if (bound && limit !== undefined && actual !== undefined) {
				return { ...entry, bound, limit, actual };
			}
			return bound ? { ...entry, bound } : entry;
		});
	}
}

export function createIngestReport(
	parsedTopLevelBlockCount: number,
	importedTopLevelBlockCount: number,
	droppedBlockTypes: readonly string[],
	drops: IngestDropCounts,
): IngestReport {
	const droppedByReason = drops.toDroppedByReason();
	return {
		parsedTopLevelBlockCount,
		importedTopLevelBlockCount,
		droppedBlockCount: Math.max(
			0,
			parsedTopLevelBlockCount - importedTopLevelBlockCount,
		),
		droppedBlockTypes: [...droppedBlockTypes],
		normalized: droppedByReason.length > 0,
		droppedByReason,
	};
}

/**
 * Slices an HTML or Markdown source to the text cap before parse, at the
 * last newline inside the cap when there is one.
 */
export function capRawTextSource(
	input: string,
	drops: IngestDropCounts,
): string {
	if (input.length <= INGEST_MAX_TEXT_SIZE) {
		return input;
	}

	const slice = input.slice(0, INGEST_MAX_TEXT_SIZE);
	const lastNewline = slice.lastIndexOf("\n");
	const truncated = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
	drops.add("text-size-exceeded", input.length - truncated.length, input.length);
	return truncated;
}

export function boundPendingBlocks(
	blocks: readonly PendingBlock[],
	drops: IngestDropCounts,
	depth = 1,
	state: { nodes: number; text: number; images: number } = {
		nodes: 0,
		text: 0,
		images: 0,
	},
): PendingBlock[] {
	const kept: PendingBlock[] = [];

	for (const block of blocks) {
		const indent =
			typeof block.props.indent === "number" ? block.props.indent : 0;
		if (depth > INGEST_MAX_NESTING_DEPTH || indent >= INGEST_MAX_NESTING_DEPTH) {
			drops.add(
				"depth-exceeded",
				countNodes(block),
				Math.max(depth, indent + 1),
			);
			continue;
		}

		if (state.nodes >= INGEST_MAX_NODE_COUNT) {
			drops.add("count-exceeded", countNodes(block));
			continue;
		}

		if (block.type === "image" && state.images >= INGEST_MAX_IMAGE_COUNT) {
			drops.add("image-count-exceeded");
			continue;
		}

		const textLen = textSizeOf(block);
		if (state.text + textLen > INGEST_MAX_TEXT_SIZE) {
			drops.add("text-size-exceeded", textLen, state.text + textLen);
			continue;
		}

		state.nodes += 1;
		state.text += textLen;
		if (block.type === "image") {
			state.images += 1;
		}

		const next: PendingBlock = {
			...block,
			props: { ...block.props },
		};
		if (block.children) {
			next.children = boundPendingBlocks(
				block.children,
				drops,
				depth + 1,
				state,
			);
		}
		kept.push(next);
	}

	return kept;
}

/**
 * `measured` appends each bound's actual value and limit to the message.
 * The JSON importer passes `false`, keeping its shorter message.
 */
export function emitIngestReport(
	editor: Pick<Editor, "internals">,
	report: IngestReport,
	source: string,
	measured = true,
): void {
	if (report.droppedByReason.length === 0) {
		return;
	}

	const truncated = report.droppedByReason.some((entry) => entry.bound);
	editor.internals.emit("diagnostic", {
		code: truncated ? "import-truncated" : "import-dropped",
		level: "warn",
		source,
		message: formatIngestMessage(report, truncated, measured),
		droppedByReason: report.droppedByReason,
	});
}

function formatIngestMessage(
	report: IngestReport,
	truncated: boolean,
	measured: boolean,
): string {
	const parts = report.droppedByReason.map((entry) => {
		const bound = entry.bound ? ` (${entry.bound})` : "";
		const values =
			measured && entry.actual !== undefined && entry.limit !== undefined
				? ` actual ${entry.actual} limit ${entry.limit}`
				: "";
		return `${entry.dropped} ${entry.reason}${bound}${values}`;
	});
	const verb = truncated ? "truncated" : "dropped";
	return `import ${verb}: ${parts.join("; ")}`;
}

function resolveActual(
	reason: IngestDropReason,
	count: number,
	stored: number | undefined,
): number | undefined {
	if (stored !== undefined) {
		return stored;
	}
	if (reason === "count-exceeded") {
		return INGEST_MAX_NODE_COUNT + count;
	}
	if (reason === "image-count-exceeded") {
		return INGEST_MAX_IMAGE_COUNT + count;
	}
	return undefined;
}

function formatDropped(reason: IngestDropReason, count: number): string {
	switch (reason) {
		case "text-size-exceeded":
			return `${count} code unit${count === 1 ? "" : "s"}`;
		case "image-count-exceeded":
			return `${count} image${count === 1 ? "" : "s"}`;
		case "forbidden-key":
			return `${count} own key${count === 1 ? "" : "s"}`;
		case "invalid-props":
			return `${count} prop${count === 1 ? "" : "s"}`;
		case "unknown-block-type":
		case "profile-disallowed":
		case "depth-exceeded":
		case "count-exceeded":
			return `${count} block${count === 1 ? "" : "s"}`;
		default: {
			const exhaustive: never = reason;
			return exhaustive;
		}
	}
}

function countNodes(block: PendingBlock): number {
	let count = 1;
	if (block.children) {
		for (const child of block.children) {
			count += countNodes(child);
		}
	}
	return count;
}

function textSizeOf(block: PendingBlock): number {
	let size = 0;
	if (block.segments && block.segments.length > 0) {
		for (const segment of block.segments) {
			if (segment.type === "text") {
				size += segment.text.length;
			}
		}
	} else if (block.content) {
		size += block.content.length;
	}

	return size;
}

/** Bounds parsed blocks to the envelope and reports what it dropped. */
export function boundIngestedBlocks(
	parsedBlocks: readonly PendingBlock[],
	drops: IngestDropCounts,
): { blocks: PendingBlock[]; report: IngestReport } {
	const bounded = boundPendingBlocks(parsedBlocks, drops);
	return {
		blocks: bounded,
		report: createIngestReport(parsedBlocks.length, bounded.length, [], drops),
	};
}

/**
 * Bounds parsed blocks, normalizes them against the editor's profile and
 * schema, and emits the ingest diagnostic under `source`.
 */
export function normalizeIngestedBlocks(
	parsedBlocks: readonly PendingBlock[],
	editor: Editor,
	drops: IngestDropCounts,
	source: string,
): { blocks: PendingBlock[]; result: IngestReport } {
	const bounded = boundPendingBlocks(parsedBlocks, drops);
	const normalized = normalizePendingBlocksForImport(
		bounded,
		editor.documentProfile,
		editor.schema,
	);

	for (const violation of normalized.violations) {
		switch (violation.reason) {
			case "unknown-block-type":
				drops.add("unknown-block-type");
				break;
			case "flow-disallowed-block":
				drops.add("profile-disallowed");
				break;
			default: {
				const exhaustive: never = violation.reason;
				throw new Error(exhaustive);
			}
		}
	}

	const droppedBlockTypes = [
		...new Set(normalized.violations.map((violation) => violation.blockType)),
	];
	const result = createIngestReport(
		parsedBlocks.length,
		normalized.blocks.length,
		droppedBlockTypes,
		drops,
	);
	emitIngestReport(editor, result, source);

	return { blocks: normalized.blocks, result };
}
