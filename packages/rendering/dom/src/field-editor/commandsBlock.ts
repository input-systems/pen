import { inputRulesEngineFacet } from "@input/pen-core";
import type { DocumentOp, Editor } from "@input/pen-types";
import {
	toggleInlineMark as toggleInlineMarkCommand,
	setInlineMark as setInlineMarkCommand,
} from "@input/pen-shortcuts";
import { matchListInputRule } from "../utils/listInputRule";
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
			// Rule ops target the document after the pending input. Apply it
			// separately because ops in one batch share pre-apply coordinates.
			editor.apply(
				[
					{
						type: "splice-text",
						blockId,
						from: range.start,
						to: range.end,
						insert: text,
					},
				],
				{ origin: "input-rule" },
			);
			editor.apply(ops, { origin: "input-rule" });
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

	editor.apply(
		[
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
		],
		{ origin: "input-rule" },
	);

	return {
		blockId,
		anchorOffset: 0,
		focusOffset: 0,
	};
}
