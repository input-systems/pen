import type { DocumentOp, Editor, InlineInsert } from "@input/pen-types";
import type { PendingBlock } from "@input/pen-core";
import type { FieldEditorTransferController } from "./controller";
import type { Delta, PenBlock } from "../utils/clipboardPayload";
import type { TransferCursorContext } from "./transferSelection";
import {
	buildBlockPlacementOps,
	placeCaretAfterPaste,
} from "./transferBlockPlacement";
import { getInsertSiblingBlockOp } from "../utils/parentIdTree";
import { generateId } from "@input/pen-types";

export function pasteBlocks(
	blocks: PenBlock[],
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	cursor: TransferCursorContext | null,
	options?: { undoGroup?: boolean },
): void {
	const valid = blocks.filter(
		(block) =>
			block &&
			typeof block === "object" &&
			block.type &&
			editor.schema.resolve(block.type),
	);
	if (valid.length === 0) return;

	const single = valid.length === 1 ? valid[0] : null;
	const singleSchema = single?.type
		? editor.schema.resolve(single.type)
		: null;
	const singleIsPartialInline =
		single &&
		singleSchema?.content === "inline" &&
		(Array.isArray(single.deltas) || typeof single.content === "string") &&
		single.isPartial;

	if (singleIsPartialInline && cursor?.isInline) {
		const deltas = getPenBlockInlineDeltas(single);
		if (deltas.length > 0) {
			pasteInlineFragment(editor, fieldEditor, deltas, cursor, options);
			return;
		}
		if (typeof single.content === "string") {
			pasteInlineText(
				editor,
				fieldEditor,
				single.content,
				cursor,
				options,
			);
		}
		return;
	}

	const { ops, caret } = buildBlockPlacementOps(
		editor,
		valid.map(toPendingBlock),
		cursor,
	);
	if (ops.length > 0) {
		editor.apply(ops, {
			origin: "user",
			...(options?.undoGroup === false ? {} : { undoGroup: true }),
		});
	}
	placeCaretAfterPaste(editor, fieldEditor, caret);
}

export function pasteInlineText(
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	text: string,
	cursor: TransferCursorContext | null,
	options?: { undoGroup?: boolean },
): void {
	if (!cursor?.isInline) return;

	const { blockId, offset, blockType } = cursor;
	const lines = text.split(/\r?\n/);

	if (lines.length === 1) {
		const insertedText = lines[0];
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: offset,
					to: offset,
					insert: insertedText,
				},
			],
			{
				origin: "user",
				...(options?.undoGroup === false ? {} : { undoGroup: true }),
			},
		);
		fieldEditor.activateTextSelection(
			blockId,
			offset + insertedText.length,
			offset + insertedText.length,
		);
		return;
	}

	const ops: DocumentOp[] = [];
	const firstLine = lines[0];
	if (firstLine) {
		ops.push({
			type: "splice-text",
			blockId,
			from: offset,
			to: offset,
			insert: firstLine,
		});
	}

	const tailText =
		editor.getBlock(blockId)?.textContent().slice(offset) ?? "";
	if (tailText) {
		ops.push({
			type: "splice-text",
			blockId,
			from: offset + (firstLine?.length ?? 0),
			to: offset + (firstLine?.length ?? 0) + tailText.length,
			insert: "",
		});
	}

	let previousBlockId = blockId;
	let lastInsertedId = blockId;
	let lastInsertedTextLength = offset + (firstLine?.length ?? 0);

	for (let i = 1; i < lines.length; i++) {
		const newId = generateId();
		const isLast = i === lines.length - 1;
		const lineText = isLast ? lines[i] + tailText : lines[i];

		ops.push({
			...(previousBlockId === blockId
				? getInsertSiblingBlockOp(editor, {
						siblingBlockId: previousBlockId,
						blockId: newId,
						blockType,
						props: {},
					})
				: {
						type: "insert-block",
						blockId: newId,
						blockType,
						props: {},
						position: { after: previousBlockId },
					}),
		});

		if (lineText) {
			ops.push({
				type: "splice-text",
				blockId: newId,
				from: 0,
				to: 0,
				insert: lineText,
			});
		}

		lastInsertedId = newId;
		lastInsertedTextLength = lines[i]?.length ?? 0;
		previousBlockId = newId;
	}

	if (ops.length > 0) {
		editor.apply(ops, {
			origin: "user",
			...(options?.undoGroup === false ? {} : { undoGroup: true }),
		});
		fieldEditor.activateTextSelection(
			lastInsertedId,
			lastInsertedTextLength,
			lastInsertedTextLength,
		);
	}
}

function pasteInlineFragment(
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	deltas: Delta[],
	cursor: TransferCursorContext | null,
	options?: { undoGroup?: boolean },
): void {
	if (!cursor?.isInline) return;

	const plainText = deltasToPlainText(deltas);
	const hasEmbeds = deltas.some((delta) => isEmbedInsert(delta.insert));
	if (!plainText && !hasEmbeds) return;
	if (
		(plainText.includes("\n") || !hasStructuredDeltas(deltas)) &&
		!hasEmbeds
	) {
		pasteInlineText(editor, fieldEditor, plainText, cursor, options);
		return;
	}

	const ops: DocumentOp[] = [];
	let offset = cursor.offset;
	for (const delta of deltas) {
		const fragment = spliceFragmentFromDelta(delta);
		if (!fragment) continue;
		ops.push({
			type: "splice-text",
			blockId: cursor.blockId,
			from: offset,
			to: offset,
			insert: fragment.insert,
			...(fragment.marks ? { marks: fragment.marks } : {}),
		});
		offset += fragment.length;
	}

	if (ops.length === 0) return;
	editor.apply(ops, {
		origin: "user",
		...(options?.undoGroup === false ? {} : { undoGroup: true }),
	});
	fieldEditor.activateTextSelection(cursor.blockId, offset, offset);
}

function getPenBlockInlineDeltas(block: PenBlock): Delta[] {
	if (Array.isArray(block.deltas)) {
		const deltas = block.deltas.filter(isClipboardInlineDelta);
		if (deltas.length > 0) return deltas;
	}

	if (typeof block.content === "string" && block.content.length > 0) {
		return [{ insert: block.content }];
	}

	return [];
}

function deltasToPlainText(deltas: Delta[]): string {
	return deltas
		.map((delta) => (typeof delta.insert === "string" ? delta.insert : ""))
		.join("");
}

function hasStructuredDeltas(deltas: Delta[]): boolean {
	return deltas.some((delta) => {
		if (isEmbedInsert(delta.insert)) {
			return true;
		}
		return !!delta.attributes && Object.keys(delta.attributes).length > 0;
	});
}

function isEmbedInsert(
	insert: Delta["insert"],
): insert is { type: string; props?: Record<string, unknown> } {
	return (
		typeof insert === "object" &&
		insert !== null &&
		typeof insert.type === "string" &&
		insert.type.length > 0
	);
}

function isClipboardInlineDelta(delta: Delta): boolean {
	if (!delta || typeof delta !== "object") {
		return false;
	}
	if (typeof delta.insert === "string") {
		return delta.insert.length > 0;
	}
	return isEmbedInsert(delta.insert);
}

function spliceFragmentFromDelta(delta: Delta): {
	insert: InlineInsert;
	marks?: Record<string, unknown>;
	length: number;
} | null {
	if (typeof delta.insert === "string") {
		if (!delta.insert) {
			return null;
		}
		return {
			insert: delta.insert,
			marks: delta.attributes,
			length: delta.insert.length,
		};
	}
	if (!isEmbedInsert(delta.insert)) {
		return null;
	}
	return {
		insert: {
			nodeType: delta.insert.type,
			props: { ...(delta.insert.props ?? {}) },
		},
		length: 1,
	};
}

function toPendingBlock(block: PenBlock): PendingBlock {
	return {
		type: block.type,
		props: block.props ?? {},
		segments: getPenBlockInlineDeltas(block).map(deltaToSegment),
		children: block.children?.map(toPendingBlock),
	};
}

function deltaToSegment(
	delta: Delta,
): NonNullable<PendingBlock["segments"]>[number] {
	if (typeof delta.insert === "string") {
		return {
			type: "text",
			text: delta.insert,
			attributes: delta.attributes,
		};
	}
	return {
		type: "node",
		nodeType: delta.insert.type,
		props: delta.insert.props,
	};
}
