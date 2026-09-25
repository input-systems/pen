import { selectionToRange } from "@input/pen-core";
import { exportMarkdownForBlocks } from "@input/pen-markdown";
import type { Editor, SelectionState, TextSelection } from "@input/pen-types";
import type { StructuredTargetInspection } from "./structuredTargets";
import { inspectStructuredTarget } from "./structuredTargets";

export type DocumentContextFormat = "summary" | "json" | "markdown";
export type DocumentContextViewMode = "resolved" | "raw";

export interface DocumentRangeInput {
	startBlockId?: unknown;
	endBlockId?: unknown;
}

export interface DocumentBlockSnapshot {
	id: string;
	type: string;
	props: Record<string, unknown>;
	content: string;
	markdown: string;
	childCount: number;
	headingPath: string[];
}

export interface SummaryBlockSnapshot {
	id: string;
	type: string;
	preview: string;
	childCount: number;
}

export interface CursorContextSnapshot {
	selection: SelectionState;
	activeBlockId: string | null;
	activeBlockType: string | null;
	selectedText: string | null;
	markdown: string;
	surroundingBlocks: SummaryBlockSnapshot[];
	structuredTarget: StructuredTargetInspection | null;
}

export interface ContextToolOptions {
	format: DocumentContextFormat;
	includeSelection: boolean;
	includeSuggestions: boolean;
	annotateBlocks: boolean;
	range: DocumentRangeInput | null;
}

type BlockSnapshotHandle =
	ReturnType<Editor["getBlock"]> extends infer T ? NonNullable<T> : never;

const SURROUNDING_BLOCK_RADIUS = 2;
const SUMMARY_PREVIEW_LIMIT = 160;

export function normalizeContextToolOptions(
	input: unknown,
): ContextToolOptions {
	const options = (input ?? {}) as Record<string, unknown>;
	return {
		format:
			options.format === "json" ||
			options.format === "markdown" ||
			options.format === "summary"
				? options.format
				: "summary",
		includeSelection: options.includeSelection === true,
		includeSuggestions: options.includeSuggestions === true,
		annotateBlocks: options.annotateBlocks === true,
		range:
			options.range && typeof options.range === "object"
				? (options.range as DocumentRangeInput)
				: null,
	};
}

export function buildCursorContext(
	editor: Editor,
	viewMode: DocumentContextViewMode = "resolved",
): CursorContextSnapshot {
	const selection = editor.getSelection();
	const activeBlockId = resolveActiveBlockId(selection);
	const boundedBlocks = resolveCursorBlocks(editor, activeBlockId, viewMode);
	const activeBlock = activeBlockId
		? (boundedBlocks.find((block) => block.id === activeBlockId) ?? null)
		: (boundedBlocks[0] ?? null);
	return {
		selection,
		activeBlockId: activeBlock?.id ?? activeBlockId,
		activeBlockType: activeBlock?.type ?? null,
		selectedText: resolveSelectedText(editor, selection, viewMode),
		markdown: formatBlocksAsMarkdown(boundedBlocks),
		surroundingBlocks: summarizeBlocks(boundedBlocks),
		structuredTarget: inspectStructuredTarget(
			editor,
			activeBlock?.id ?? activeBlockId,
		),
	};
}

export function resolveDocumentBlocks(
	editor: Editor,
	range: DocumentRangeInput | null,
	viewMode: DocumentContextViewMode,
): DocumentBlockSnapshot[] {
	const headingStack: Array<{ level: number; text: string }> = [];
	return resolveDocumentBlockHandles(editor, range).map((handle) =>
		toBlockSnapshot(handle, editor, viewMode, headingStack),
	);
}

export function buildDocumentBlockSnapshots(
	editor: Editor,
	viewMode: DocumentContextViewMode,
): DocumentBlockSnapshot[] {
	return resolveDocumentBlocks(editor, null, viewMode);
}

export function formatBlocksAsMarkdown(
	blocks: DocumentBlockSnapshot[],
): string {
	return blocks
		.map((block) => block.markdown)
		.filter((block) => block.length > 0)
		.join("\n\n");
}

/** Matches one block annotation comment produced by {@link formatBlocksAsAnnotatedMarkdown}. */
const BLOCK_ANNOTATION_PATTERN = /^<!-- block:(\S+) (\S+) -->$/;

/**
 * Markdown with an id/type comment above every block so a model can address
 * blocks precisely. Annotations are metadata: strip them with
 * {@link stripBlockAnnotations} before importing the markdown back.
 */
export function formatBlocksAsAnnotatedMarkdown(
	blocks: DocumentBlockSnapshot[],
): string {
	return blocks
		.map(
			(block) =>
				`<!-- block:${block.id} ${block.type} -->\n${block.markdown.trimEnd()}`,
		)
		.join("\n\n");
}

/**
 * Removes the `<!-- block:<id> <type> -->` lines that annotate markdown given
 * to a model. Models copy the annotations back into their payloads, so this
 * runs on the way in — an annotation that reaches the document becomes literal
 * text in a block.
 */
export function stripBlockAnnotations(markdown: string): string {
	if (!markdown.includes("<!-- block:")) {
		return markdown;
	}
	const withoutAnnotations = markdown
		.split("\n")
		.filter((line) => !BLOCK_ANNOTATION_PATTERN.test(line.trim()))
		.join("\n");
	return trimMarkdownEnvelope(withoutAnnotations);
}

function trimMarkdownEnvelope(value: string): string {
	let start = 0;
	let end = value.length;
	while (
		start < end &&
		isMarkdownEnvelopeWhitespace(value.charCodeAt(start))
	) {
		start += 1;
	}
	while (
		end > start &&
		isMarkdownEnvelopeWhitespace(value.charCodeAt(end - 1))
	) {
		end -= 1;
	}
	return value.slice(start, end);
}

// NBSP is intentionally excluded because Pen uses it for empty paragraphs.
function isMarkdownEnvelopeWhitespace(code: number): boolean {
	return code === 9 || code === 10 || code === 13 || code === 32;
}

export function exportDocumentRangeAsMarkdown(
	editor: Editor,
	range: DocumentRangeInput | null,
	viewMode: DocumentContextViewMode,
): string {
	return exportMarkdownForBlocks(
		editor,
		resolveDocumentBlockHandles(editor, range),
		{ viewMode },
	);
}

export function summarizeBlocks(
	blocks: DocumentBlockSnapshot[],
): SummaryBlockSnapshot[] {
	return blocks.map((block) => ({
		id: block.id,
		type: block.type,
		preview: truncateText(block.content, SUMMARY_PREVIEW_LIMIT),
		childCount: block.childCount,
	}));
}

export function resolveSelectionText(
	editor: Editor,
	selection: TextSelection,
	viewMode: DocumentContextViewMode,
): string {
	const range = selectionToRange(editor.internals.doc, selection);
	const blockIds = range.blockRange;
	const parts = blockIds.map((blockId, index) => {
		const block = editor.getBlock(blockId);
		if (!block) return "";

		let rawOffset = 0;
		let text = "";
		const startOffset = index === 0 ? range.start.offset : 0;
		const endOffset =
			index === blockIds.length - 1
				? range.end.offset
				: Number.POSITIVE_INFINITY;

		for (const delta of block.textDeltas()) {
			const length = delta.insert.length;
			const rawStart = rawOffset;
			const rawEnd = rawOffset + length;
			rawOffset = rawEnd;

			if (endOffset <= rawStart || startOffset >= rawEnd) {
				continue;
			}

			const sliceStart = Math.max(0, startOffset - rawStart);
			const sliceEnd = Math.min(length, endOffset - rawStart);
			if (sliceEnd <= sliceStart) {
				continue;
			}

			const suggestion = delta.attributes?.suggestion as
				{ action?: string } | undefined;
			if (viewMode === "resolved" && suggestion?.action === "delete") {
				continue;
			}

			text += delta.insert.slice(sliceStart, sliceEnd);
		}

		return text;
	});

	return parts.join("\n");
}

export function resolveSelectedText(
	editor: Editor,
	selection: SelectionState,
	viewMode: DocumentContextViewMode,
): string | null {
	if (!selection) {
		return null;
	}
	if (selection.type === "text") {
		return resolveSelectionText(editor, selection, viewMode);
	}
	const text = editor.getSelectedText();
	return typeof text === "string" && text.length > 0 ? text : null;
}

function resolveActiveBlockId(selection: SelectionState): string | null {
	if (!selection) return null;
	if (selection.type === "text") return selection.focus.blockId;
	if (selection.type === "block") return selection.blockIds[0] ?? null;
	if (selection.type === "cell") return selection.blockId;
	return null;
}

function resolveSurroundingBlocks(
	blocks: DocumentBlockSnapshot[],
	activeBlockIndex: number,
): SummaryBlockSnapshot[] {
	if (blocks.length === 0) {
		return [];
	}

	if (activeBlockIndex < 0) {
		return summarizeBlocks(blocks.slice(0, SURROUNDING_BLOCK_RADIUS + 1));
	}

	const startIndex = Math.max(0, activeBlockIndex - SURROUNDING_BLOCK_RADIUS);
	const endIndex = Math.min(
		blocks.length,
		activeBlockIndex + SURROUNDING_BLOCK_RADIUS + 1,
	);
	return summarizeBlocks(blocks.slice(startIndex, endIndex));
}

function normalizeHeadingLevel(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 1;
	}
	return Math.min(6, Math.max(1, Math.trunc(value)));
}

function resolveCursorBlocks(
	editor: Editor,
	activeBlockId: string | null,
	viewMode: DocumentContextViewMode,
): DocumentBlockSnapshot[] {
	const activeBlock = activeBlockId ? editor.getBlock(activeBlockId) : null;
	if (!activeBlock) {
		return resolveDocumentBlocks(editor, null, viewMode).slice(
			0,
			SURROUNDING_BLOCK_RADIUS + 1,
		);
	}
	if (
		typeof activeBlock.prev === "undefined" ||
		typeof activeBlock.next === "undefined"
	) {
		const blocks = resolveDocumentBlocks(editor, null, viewMode);
		const activeBlockIndex = blocks.findIndex(
			(block) => block.id === activeBlock.id,
		);
		if (activeBlockIndex < 0) {
			return blocks.slice(0, SURROUNDING_BLOCK_RADIUS + 1);
		}
		const startIndex = Math.max(
			0,
			activeBlockIndex - SURROUNDING_BLOCK_RADIUS,
		);
		const endIndex = Math.min(
			blocks.length,
			activeBlockIndex + SURROUNDING_BLOCK_RADIUS + 1,
		);
		return blocks.slice(startIndex, endIndex);
	}

	const previousBlocks: DocumentBlockSnapshot[] = [];
	let previous = activeBlock.prev;
	while (previous && previousBlocks.length < SURROUNDING_BLOCK_RADIUS) {
		previousBlocks.unshift(toBlockSnapshot(previous, editor, viewMode));
		previous = previous.prev;
	}

	const nextBlocks: DocumentBlockSnapshot[] = [];
	let next = activeBlock.next;
	while (next && nextBlocks.length < SURROUNDING_BLOCK_RADIUS) {
		nextBlocks.push(toBlockSnapshot(next, editor, viewMode));
		next = next.next;
	}

	return [
		...previousBlocks,
		toBlockSnapshot(activeBlock, editor, viewMode),
		...nextBlocks,
	];
}

function toBlockSnapshot(
	block: BlockSnapshotHandle,
	editor: Editor,
	viewMode: DocumentContextViewMode,
	headingStack: Array<{ level: number; text: string }> = [],
): DocumentBlockSnapshot {
	const content =
		viewMode === "resolved"
			? block.textContent({ resolved: true })
			: block.textContent();
	const headingPath = resolveHeadingPath(block, content, headingStack);
	return {
		id: block.id,
		type: block.type,
		props: block.props,
		content,
		markdown: exportMarkdownForBlocks(editor, [block], { viewMode }),
		childCount: block.children.length,
		headingPath,
	};
}

export function resolveDocumentBlockHandles(
	editor: Editor,
	range: DocumentRangeInput | null,
): BlockSnapshotHandle[] {
	const blocks = listDocumentBlockHandles(editor);
	const startBlockId =
		typeof range?.startBlockId === "string" ? range.startBlockId : null;
	const endBlockId =
		typeof range?.endBlockId === "string" ? range.endBlockId : null;

	if (!startBlockId && !endBlockId) {
		return blocks;
	}

	const startIndex = startBlockId
		? blocks.findIndex((block) => block.id === startBlockId)
		: 0;
	const endIndex = endBlockId
		? blocks.findIndex((block) => block.id === endBlockId)
		: blocks.length - 1;

	if (startIndex === -1 || endIndex === -1) {
		return blocks;
	}

	const rangeStart = Math.min(startIndex, endIndex);
	const rangeEnd = Math.max(startIndex, endIndex) + 1;
	return blocks.slice(rangeStart, rangeEnd);
}

export function listDocumentBlockHandles(
	editor: Editor,
): BlockSnapshotHandle[] {
	const allBlocks = editor.documentState?.allBlocks?.();
	if (allBlocks) {
		return Array.from(allBlocks) as BlockSnapshotHandle[];
	}
	return Array.from(editor.blocks()) as BlockSnapshotHandle[];
}

function truncateText(value: string, limit: number): string {
	const trimmed = value.trim();
	if (trimmed.length <= limit) {
		return trimmed;
	}
	return `${trimmed.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function resolveHeadingPath(
	block: BlockSnapshotHandle,
	content: string,
	headingStack: Array<{ level: number; text: string }>,
): string[] {
	if (block.type === "heading") {
		const level = normalizeHeadingLevel(block.props.level);
		while (
			headingStack.length > 0 &&
			(headingStack[headingStack.length - 1]?.level ?? 0) >= level
		) {
			headingStack.pop();
		}
		if (content.trim().length > 0) {
			headingStack.push({ level, text: content.trim() });
		}
		return headingStack.map((entry) => entry.text);
	}

	return headingStack.map((entry) => entry.text);
}
