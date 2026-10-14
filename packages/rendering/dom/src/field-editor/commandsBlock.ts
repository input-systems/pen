import { inputRulesEngineFacet } from "@input/pen-core";
import type { DocumentOp, Editor } from "@input/pen-types";
import {
	toggleInlineMark as toggleInlineMarkCommand,
	setInlineMark as setInlineMarkCommand,
} from "@input/pen-shortcuts";
import { matchListInputRule } from "../utils/listInputRule";
import { applyInputRule } from "./inputRuleApply";
import {
	type BlockInputRuleEngine,
	type SelectionRange,
	type SelectionTarget,
} from "./commandsShared";

export function toggleInlineMark(editor: Editor, markType: string): boolean {
	return toggleInlineMarkCommand(editor, markType);
}

export function setInlineMark(
	editor: Editor,
	markType: string,
	value: Record<string, unknown> | null,
): boolean {
	return setInlineMarkCommand(editor, markType, value);
}

export function getConvertBlockOps(
	editor: Editor,
	options: {
		blockId: string;
		newType: string;
		newProps?: Record<string, unknown>;
	},
): DocumentOp[] {
	const existingParentId = editor.documentState.parentOf(options.blockId);
	const ops: DocumentOp[] = [
		{
			type: "set-props",
			blockId: options.blockId,
			props: { type: options.newType, ...options.newProps },
		} as DocumentOp,
	];

	if (existingParentId) {
		ops.push({
			type: "set-props",
			blockId: options.blockId,
			props: { parentId: existingParentId },
		} as DocumentOp);
	}

	return ops;
}

export function applyListInputRule(
	editor: Editor,
	options: {
		blockId: string;
		range: SelectionRange | null;
		text: string;
	},
): SelectionTarget | null {
	const { blockId, range, text } = options;
	if (!range || range.start !== range.end) {
		return null;
	}

	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}

	const inputRuleEngine =
		(editor.facet(inputRulesEngineFacet) as BlockInputRuleEngine | null) ??
		null;
	if (inputRuleEngine) {
		const ops = inputRuleEngine.tryMatch(editor, blockId, text, {
			offset: range.start,
		});
		if (ops) {
			applyInputRule(editor, { blockId, offset: range.start, text }, ops);
			return {
				blockId,
				anchorOffset: 0,
				focusOffset: 0,
			};
		}
	}

	if (block.type !== "paragraph") {
		return null;
	}

	const match = matchListInputRule(block.textContent(), range, text);
	if (!match) {
		return null;
	}

	// Core drops a conversion to a type the schema does not register but still
	// applies the marker deletion, so the typed marker would vanish.
	const registered = editor.schema
		.allBlocks()
		.some((schema) => schema.type === match.blockType);
	if (!registered) {
		return null;
	}

	applyInputRule(editor, { blockId, offset: range.start, text }, [
		{
			type: "splice-text",
			blockId,
			from: match.deleteRange.start,
			to: match.deleteRange.end,
			insert: "",
		},
		{
			type: "set-props",
			blockId,
			props: { type: match.blockType, ...match.newProps },
		},
	]);

	return {
		blockId,
		anchorOffset: 0,
		focusOffset: 0,
	};
}
