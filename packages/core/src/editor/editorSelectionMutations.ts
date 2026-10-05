import type {
	DocumentOp,
	ApplyOptions,
	DocumentRange,
	Block,
	CRDTArray,
	Position,
} from "@input/pen-types";
import { generateId } from "@input/pen-types";
import { usesInlineTextSelection } from "../schema/fieldEditorCapabilities";
import {
	resolveCellSelectionCoord,
	resolveCellSelectionMatrix,
} from "./cellSelection";

import type { EditorSelectionMutationContext } from "./editorImplContext";
import { resolvePosition } from "./applySharedHelpers";

type EditorImplRuntime = EditorSelectionMutationContext;

export function replaceEditorSelection(
	editor: EditorImplRuntime,
	content: string | Block[],
): void {
	const self = editor as EditorImplRuntime;
	const sel = self._selection.getSelection();
	if (!sel) return;

	if (sel.type === "text") {
		const range = self._getSelectionRange(sel);
		if (range.isMultiBlock) {
			if (typeof content === "string") {
				self._replaceMultiBlockTextRange(range, content);
			}
			return;
		}

		const from = range.start.offset;
		const to = range.end.offset;
		const ops: DocumentOp[] = [];
		if (to > from) {
			ops.push({
				type: "splice-text",
				blockId: range.start.blockId,
				from,
				to,
				insert: "",
			});
		}
		if (typeof content === "string" && content.length > 0) {
			ops.push({
				type: "splice-text",
				blockId: range.start.blockId,
				from,
				to: from,
				insert: content,
			});
		}
		if (ops.length > 0) {
			self.apply(ops);
		}
		const nextOffset =
			typeof content === "string" ? from + content.length : from;
		self._collapseToPoint({
			blockId: range.start.blockId,
			offset: nextOffset,
		});
		return;
	}

	if (sel.type === "block" && sel.blockIds.length > 0) {
		const firstId = sel.blockIds[0];
		const firstIndex = resolvePosition(self._pipeline, {
			before: firstId,
		});
		const ops: DocumentOp[] = [];

		for (const id of sel.blockIds) {
			ops.push({ type: "delete-block", blockId: id });
		}

		const insertPosition: Position =
			firstIndex === 0
				? "first"
				: {
						after: (self._doc.blockOrder as CRDTArray<string>).get(
							firstIndex - 1,
						) as string,
					};

		if (typeof content === "string") {
			const newId = generateId();
			ops.push({
				type: "insert-block",
				blockId: newId,
				blockType: "paragraph",
				props: {},
				position: insertPosition,
			});
			if (content.length > 0) {
				ops.push({
					type: "splice-text",
					blockId: newId,
					from: 0,
					to: 0,
					insert: content,
				});
			}
		} else if (Array.isArray(content)) {
			let prevPosition = insertPosition;
			for (const block of content) {
				const newId = generateId();
				ops.push({
					type: "insert-block",
					blockId: newId,
					blockType: block.type,
					props: block.props ?? {},
					position: prevPosition,
				});
				if (
					typeof block.content === "string" &&
					block.content.length > 0
				) {
					ops.push({
						type: "splice-text",
						blockId: newId,
						from: 0,
						to: 0,
						insert: block.content,
					});
				}
				prevPosition = { after: newId };
			}
		}

		self.apply(ops);
	}
}

export function deleteEditorSelection(
	editor: EditorImplRuntime,
	options?: ApplyOptions,
): void {
	const self = editor as EditorImplRuntime;
	const sel = self._selection.getSelection();
	if (!sel) return;

	if (sel.type === "text") {
		const range = self._getSelectionRange(sel);
		if (range.isMultiBlock) {
			self._deleteMultiBlockTextRange(range, options);
			return;
		}

		if (
			!self._usesInlineTextSelection(range.start.blockId) &&
			self._isWholeBlockSelection(
				range.start.blockId,
				range.start.offset,
				range.end.offset,
			)
		) {
			self.apply(
				[
					{
						type: "delete-block",
						blockId: range.start.blockId,
					},
				],
				options,
			);
			self.setSelection(null);
			return;
		}

		const from = range.start.offset;
		const to = range.end.offset;
		if (to > from) {
			self.apply(
				[
					{
						type: "splice-text",
						blockId: range.start.blockId,
						from,
						to,
						insert: "",
					},
				],
				options,
			);
		}
		self._collapseToPoint({
			blockId: range.start.blockId,
			offset: from,
		});
		return;
	}

	if (sel.type === "block") {
		const ops: DocumentOp[] = sel.blockIds.map((id: string) => ({
			type: "delete-block" as const,
			blockId: id,
		}));
		self.apply(ops, options);
		self.setSelection(null);
	}

	if (sel.type === "cell") {
		const block = self.getBlock(sel.blockId);
		if (!block) return;
		const table = block.as("table");
		if (!table) return;
		// An in-cell range (A1) deletes that range, not the cell's text.
		if (sel.text) {
			const coord = resolveCellSelectionCoord(block, sel, sel.anchor);
			if (!coord) return;
			const from = Math.min(sel.text.anchor, sel.text.focus);
			const to = Math.max(sel.text.anchor, sel.text.focus);
			if (to > from) {
				self.apply(
					[
						{
							type: "splice-text",
							blockId: sel.blockId,
							cell: { row: coord.row, col: coord.col },
							from,
							to,
							insert: "",
						},
					],
					options,
				);
			}
			self.setSelection({ ...sel, text: { anchor: from, focus: from } });
			return;
		}
		const ops: DocumentOp[] = [];
		for (const rowCells of resolveCellSelectionMatrix(block, sel)) {
			for (const cellCoord of rowCells) {
				const cell = table.tableCell(cellCoord.row, cellCoord.col);
				if (!cell) continue;
				const len = cell.length();
				if (len > 0) {
					ops.push({
						type: "splice-text",
						blockId: sel.blockId,
						cell: { row: cellCoord.row, col: cellCoord.col },
						from: 0,
						to: len,
						insert: "",
					});
				}
			}
		}
		if (ops.length > 0) {
			self.apply(ops, options);
		}
		self.setSelection({
			...sel,
			head: sel.anchor,
		});
	}
}

export function getTextForBlock(
	editor: EditorImplRuntime,
	blockId: string,
): string {
	const self = editor as EditorImplRuntime;
	return self.getBlock(blockId)?.textContent() ?? "";
}

export function usesInlineTextSelectionForBlock(
	editor: EditorImplRuntime,
	blockId: string,
): boolean {
	const self = editor as EditorImplRuntime;
	const block = self.getBlock(blockId);
	if (!block) {
		return false;
	}

	const schema = self._registry.resolve(block.type);
	if (!schema) {
		return false;
	}

	return usesInlineTextSelection(schema);
}

export function getBlockSelectionSpan(
	editor: EditorImplRuntime,
	blockId: string,
): number {
	const self = editor as EditorImplRuntime;
	if (self._usesInlineTextSelection(blockId)) {
		return self._getTextForBlock(blockId).length;
	}
	return self.getBlock(blockId) ? 1 : 0;
}

export function isWholeBlockSelection(
	editor: EditorImplRuntime,
	blockId: string,
	startOffset: number,
	endOffset: number,
): boolean {
	const self = editor as EditorImplRuntime;
	const span = self._getBlockSelectionSpan(blockId);
	if (span <= 0) {
		return false;
	}
	return startOffset <= 0 && endOffset >= span;
}

export function sliceInlineDeltas(
	editor: EditorImplRuntime,
	blockId: string,
	startOffset: number,
): Array<{ insert: string; attributes?: Record<string, unknown> }> {
	const self = editor as EditorImplRuntime;
	const handle = self.getBlock(blockId);
	if (!handle) return [];
	const deltas = handle.textDeltas();
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
			sliced.push({
				insert: text,
				...(delta.attributes ? { attributes: delta.attributes } : {}),
			});
		}
		offset += length;
	}
	return sliced;
}

export function buildMultiBlockTextReplacement(
	editor: EditorImplRuntime,
	range: DocumentRange,
	insertedText: string,
): { ops: DocumentOp[]; caret: { blockId: string; offset: number } } {
	const self = editor as EditorImplRuntime;
	const startId = range.start.blockId;
	const endId = range.end.blockId;
	const startText = self._getTextForBlock(startId);
	const middleIds = range.blockRange.slice(1, -1);
	const suffixDeltas = self._sliceInlineDeltas(endId, range.end.offset);
	const ops: DocumentOp[] = [];
	if (range.start.offset < startText.length) {
		ops.push({
			type: "splice-text",
			blockId: startId,
			from: range.start.offset,
			to: startText.length,
			insert: "",
		});
	}
	if (range.end.offset > 0) {
		ops.push({
			type: "splice-text",
			blockId: endId,
			from: 0,
			to: range.end.offset,
			insert: "",
		});
	}
	for (const blockId of middleIds)
		ops.push({ type: "delete-block", blockId });
	let insertionOffset = range.start.offset;
	if (insertedText.length > 0) {
		ops.push({
			type: "splice-text",
			blockId: startId,
			from: insertionOffset,
			to: insertionOffset,
			insert: insertedText,
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
	ops.push({ type: "delete-block", blockId: endId });
	return {
		ops,
		caret: {
			blockId: startId,
			offset: range.start.offset + insertedText.length,
		},
	};
}

export function deleteMultiBlockTextRange(
	editor: EditorImplRuntime,
	range: DocumentRange,
	options?: ApplyOptions,
): { blockId: string; offset: number } | null {
	const self = editor as EditorImplRuntime;
	const startId = range.start.blockId;
	const endId = range.end.blockId;
	if (startId === endId) {
		const from = range.start.offset;
		const to = range.end.offset;
		if (to > from) {
			self.apply(
				[
					{
						type: "splice-text",
						blockId: startId,
						from,
						to,
						insert: "",
					},
				],
				options,
			);
		}
		const caret = { blockId: startId, offset: from };
		self._collapseToPoint(caret);
		return caret;
	}
	const startInline = self._usesInlineTextSelection(startId);
	const endInline = self._usesInlineTextSelection(endId);
	if (startInline && endInline) {
		const { ops, caret } = self._buildMultiBlockTextReplacement(range, "");
		self.apply(ops, options);
		self._collapseToPoint(caret);
		return caret;
	}
	const middleIds = range.blockRange.slice(1, -1);
	const ops: DocumentOp[] = [];
	if (startInline) {
		const startText = self._getTextForBlock(startId);
		if (range.start.offset < startText.length) {
			ops.push({
				type: "splice-text",
				blockId: startId,
				from: range.start.offset,
				to: startText.length,
				insert: "",
			});
		}
	} else if (
		self._isWholeBlockSelection(
			startId,
			range.start.offset,
			self._getBlockSelectionSpan(startId),
		)
	) {
		ops.push({ type: "delete-block", blockId: startId });
	}
	for (const blockId of middleIds)
		ops.push({ type: "delete-block", blockId });
	if (endInline) {
		if (range.end.offset > 0) {
			ops.push({
				type: "splice-text",
				blockId: endId,
				from: 0,
				to: range.end.offset,
				insert: "",
			});
		}
	} else if (self._isWholeBlockSelection(endId, 0, range.end.offset)) {
		ops.push({ type: "delete-block", blockId: endId });
	}
	if (ops.length > 0) self.apply(ops, options);
	const caret = startInline
		? { blockId: startId, offset: range.start.offset }
		: endInline
			? { blockId: endId, offset: 0 }
			: null;
	if (caret) self._collapseToPoint(caret);
	else self.setSelection(null);
	return caret;
}

export function replaceMultiBlockTextRange(
	editor: EditorImplRuntime,
	range: DocumentRange,
	text: string,
): { blockId: string; offset: number } {
	const self = editor as EditorImplRuntime;
	const { ops, caret } = self._buildMultiBlockTextReplacement(range, text);
	self.apply(ops);
	self._collapseToPoint(caret);
	return caret;
}
