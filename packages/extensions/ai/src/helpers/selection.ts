import { deepEqual, isCollapsed, selectionToRange } from "@input/pen-core";
import type { DocumentOp, Editor, TextSelection } from "@input/pen-types";

export function buildSelectionReplacementOps(
	editor: Editor,
	selection: TextSelection,
	insertedText: string,
	commonMarks: Record<string, unknown> | undefined,
): DocumentOp[] {
	const range = selectionToRange(editor.internals.doc, selection);
	if (range.start.blockId === range.end.blockId) {
		return [
			{
				type: "splice-text",
				blockId: range.start.blockId,
				from: range.start.offset,
				to: range.start.offset + range.end.offset - range.start.offset,
				insert: insertedText,
				...(commonMarks ? { marks: commonMarks } : {}),
			},
		];
	}
	const startId = range.start.blockId;
	const endId = range.end.blockId;
	const startText = editor.getBlock(startId)?.textContent() ?? "";
	const middleIds = range.blockRange.slice(1, -1);
	const suffixDeltas = sliceInlineDeltasFromOffset(
		editor.getBlock(endId)?.textDeltas() ?? [],
		range.end.offset,
	);
	const ops: DocumentOp[] = [];

	if (range.start.offset < startText.length) {
		ops.push({
			type: "splice-text",
			blockId: startId,
			from: range.start.offset,
			to: range.start.offset + startText.length - range.start.offset,
			insert: "",
		});
	}

	if (range.end.offset > 0) {
		ops.push({
			type: "splice-text",
			blockId: endId,
			from: 0,
			to: 0 + range.end.offset,
			insert: "",
		});
	}

	for (const blockId of middleIds) {
		ops.push({
			type: "delete-block",
			blockId,
		});
	}

	let insertionOffset = range.start.offset;
	if (insertedText.length > 0) {
		ops.push({
			type: "splice-text",
			blockId: startId,
			from: insertionOffset,
			to: insertionOffset,
			insert: insertedText,
			...(commonMarks ? { marks: commonMarks } : {}),
		});
		insertionOffset += insertedText.length;
	}

	for (const delta of suffixDeltas) {
		ops.push({
			type: "splice-text",
			blockId: startId,
			from: insertionOffset,
			to: insertionOffset,
			insert: delta.insert,
			marks: delta.attributes,
		});
		insertionOffset += delta.insert.length;
	}

	ops.push({
		type: "delete-block",
		blockId: endId,
	});
	return ops;
}

export function resolveCommonSelectionMarks(
	editor: Editor,
	selection: TextSelection,
): Record<string, unknown> | undefined {
	const range = selectionToRange(editor.internals.doc, selection);
	let commonMarks: Record<string, unknown> | null = null;

	for (const [blockIndex, blockId] of range.blockRange.entries()) {
		const block = editor.getBlock(blockId);
		if (!block) continue;

		const startOffset = blockIndex === 0 ? range.start.offset : 0;
		const endOffset =
			blockIndex === range.blockRange.length - 1
				? range.end.offset
				: Number.POSITIVE_INFINITY;
		let offset = 0;

		for (const delta of block.textDeltas()) {
			const deltaStart = offset;
			const deltaEnd = offset + delta.insert.length;
			offset = deltaEnd;
			if (endOffset <= deltaStart || startOffset >= deltaEnd) continue;

			const suggestion = delta.attributes?.suggestion as
				{ action?: string } | undefined;
			if (suggestion?.action === "delete") continue;

			const marks = resolveUserMarks(editor, delta.attributes);
			if (commonMarks === null) {
				commonMarks = marks;
				continue;
			}
			for (const [type, value] of Object.entries(commonMarks)) {
				if (!deepEqual(value, marks[type])) {
					delete commonMarks[type];
				}
			}
		}
	}

	return commonMarks && Object.keys(commonMarks).length > 0
		? commonMarks
		: undefined;
}

function resolveUserMarks(
	editor: Editor,
	attributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const marks: Record<string, unknown> = {};
	for (const [type, value] of Object.entries(attributes ?? {})) {
		const schema = editor.schema.resolveInline(type);
		if (schema?.kind !== "mark" || schema.system || value == null) continue;
		marks[type] = value;
	}
	return marks;
}

function sliceInlineDeltasFromOffset(
	deltas: readonly { insert: string; attributes?: Record<string, unknown> }[],
	startOffset: number,
): Array<{ insert: string; attributes?: Record<string, unknown> }> {
	const sliced: Array<{
		insert: string;
		attributes?: Record<string, unknown>;
	}> = [];
	let offset = 0;
	for (const delta of deltas) {
		const length = delta.insert.length;
		if (startOffset >= offset + length) {
			offset += length;
			continue;
		}
		const localStart = Math.max(0, startOffset - offset);
		const text = delta.insert.slice(localStart);
		if (text.length > 0) {
			sliced.push(
				delta.attributes
					? { insert: text, attributes: delta.attributes }
					: { insert: text },
			);
		}
		offset += length;
	}
	return sliced;
}

export function resolveSelectionText(
	editor: Editor,
	selection: TextSelection,
): string {
	const range = selectionToRange(editor.internals.doc, selection);
	const blockIds = range.blockRange;
	const parts = blockIds.map((blockId, index) => {
		const block = editor.getBlock(blockId);
		if (!block) return "";

		let rawOffset = 0;
		let resolved = "";
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
			if (suggestion?.action === "delete") {
				continue;
			}

			resolved += delta.insert.slice(sliceStart, sliceEnd);
		}

		return resolved;
	});

	return parts.join("\n");
}

export function shouldReplaceEmptyMarkdownTarget(
	block: ReturnType<Editor["getBlock"]>,
): boolean {
	if (!block) {
		return false;
	}

	return (
		block.type === "paragraph" &&
		isVisuallyEmptyInlineText(block.textContent({ resolved: true }))
	);
}

export function shouldTrimLeadingBlankBlockGenerationText(
	block: ReturnType<Editor["getBlock"]>,
): boolean {
	if (!block) {
		return false;
	}
	return isVisuallyEmptyInlineText(block.textContent({ resolved: true }));
}

export function trimLeadingBlankBlockGenerationText(text: string): string {
	return text.replace(/^(?:[ \t]*\r?\n)+/, "");
}

function isVisuallyEmptyInlineText(text: string): boolean {
	return text.trim().length === 0;
}

export function resolveBlockInsertionOffset(
	editor: Editor,
	blockId: string,
): number {
	const selection = editor.selection;
	const block = editor.getBlock(blockId);
	const fallbackOffset =
		block && isVisuallyEmptyInlineText(block.textContent())
			? 0
			: (block?.textContent().length ?? 0);
	if (selection?.type !== "text") {
		return fallbackOffset;
	}
	const range = selectionToRange(editor.internals.doc, selection);
	if (isCollapsed(selection)) {
		return selection.anchor.blockId === blockId
			? selection.anchor.offset
			: fallbackOffset;
	}
	if (range.start.blockId === blockId && range.end.blockId === blockId) {
		return range.end.offset;
	}
	if (range.end.blockId === blockId) {
		return range.end.offset;
	}
	if (range.start.blockId === blockId) {
		return range.start.offset;
	}
	return fallbackOffset;
}
