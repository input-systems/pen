import {
	inputRulesEngineFacet,
	supportsInlineInputRules,
} from "@input/pen-core";
import type { DocumentOp, Editor } from "@input/pen-types";
import { matchInlineInputRule } from "../utils/inlineInputRule";
import type { InlineInputRuleEngine } from "./crdt";
import { applyInputRule } from "./inputRuleApply";

export type InlineInputRuleSelectionTarget = {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
	/** The marks the rule applied; they end at the caret it leaves. */
	marks: readonly string[];
};

/**
 * Runs the registered inline input rules against a single typed character and
 * applies the first match, so that markdown-style shorthand becomes marks as
 * the user types.
 *
 * @param editor - The editor whose document receives the resulting ops.
 * @param options - The block, the caret offset, and the single character typed.
 * @returns The selection target to restore after the rewrite and the marks it
 * applied, or `null` when no rule matches.
 */
export function applyInlineInputRule(
	editor: Editor,
	options: {
		blockId: string;
		offset: number;
		text: string;
	},
): InlineInputRuleSelectionTarget | null {
	const { blockId, offset, text } = options;
	if (text.length !== 1) {
		return null;
	}

	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}

	const blockSchema = editor.schema.resolve(block.type);
	if (!supportsInlineInputRules(blockSchema)) {
		return null;
	}

	const inputRuleEngine =
		(editor.facet(inputRulesEngineFacet) as InlineInputRuleEngine | null) ??
		null;
	const ops =
		inputRuleEngine?.tryMatchInline(editor, blockId, text, { offset }) ??
		resolveFallbackInlineInputRule(
			editor,
			blockId,
			block.textContent(),
			offset,
			text,
		);
	if (!ops) {
		return null;
	}

	const selectionTarget = resolveInlineSelectionTarget(blockId, ops);
	if (!selectionTarget) {
		return null;
	}

	applyInputRule(editor, { blockId, offset, text }, ops);
	return selectionTarget;
}

function resolveFallbackInlineInputRule(
	editor: Editor,
	blockId: string,
	blockText: string,
	offset: number,
	text: string,
): DocumentOp[] | null {
	const match = matchInlineInputRule(blockText, offset, text);
	if (!match) {
		return null;
	}

	const markType = Object.keys(match.marks)[0];
	if (!markType || !editor.schema.resolveInline(markType)) {
		return null;
	}

	return [
		{
			type: "splice-text",
			blockId,
			from: match.deleteRange.start,
			to: match.deleteRange.end,
			insert: "",
		},
		{
			type: "splice-text",
			blockId,
			from: match.deleteRange.start,
			to: match.deleteRange.start,
			insert: match.text,
			marks: match.marks,
		},
	];
}

function resolveInlineSelectionTarget(
	blockId: string,
	ops: DocumentOp[],
): InlineInputRuleSelectionTarget | null {
	let nextOffset: number | null = null;
	let marks: readonly string[] = [];
	for (const op of ops) {
		if (op.type !== "splice-text" || op.blockId !== blockId) {
			continue;
		}
		if (typeof op.insert === "string" && op.insert.length > 0) {
			nextOffset = op.from + op.insert.length;
			marks = Object.keys(op.marks ?? {});
		}
	}

	if (nextOffset == null) {
		return null;
	}

	return {
		blockId,
		anchorOffset: nextOffset,
		focusOffset: nextOffset,
		marks,
	};
}
