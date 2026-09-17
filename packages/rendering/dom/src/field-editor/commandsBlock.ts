import { applySplitBlock, inputRulesEngineFacet } from "@input/pen-core";
import { generateId } from "@input/pen-types";
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

// ── Commands ─────────────────────────────────────────────────

export function splitBlockAtOffset(
	editor: Editor,
	options: {
		blockId: string;
		offset: number;
		newBlockType?: string;
	},
): SelectionTarget {
	const { blockId, offset, newBlockType } = options;
	const newBlockId = generateId();

	applySplitBlock(editor, {
		blockId,
		offset,
		newBlockId,
		newBlockType,
		applyOptions: { origin: "user" },
	});
	editor.selectText(newBlockId, 0, 0);

	return {
		blockId: newBlockId,
		anchorOffset: 0,
		focusOffset: 0,
	};
}

export function convertBlock(
	editor: Editor,
	options: {
		blockId: string;
		newType: string;
		newProps?: Record<string, unknown>;
	},
): SelectionTarget {
	editor.apply(getConvertBlockOps(editor, options), { origin: "user" });

	return {
		blockId: options.blockId,
		anchorOffset: 0,
		focusOffset: 0,
	};
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

export function insertTextAtRange(
	editor: Editor,
	options: {
		blockId: string;
		range: SelectionRange | null;
		text: string;
	},
): SelectionTarget {
	const { blockId, range, text } = options;
	const start = range?.start ?? 0;
	const end = range?.end ?? start;
	const ops: DocumentOp[] = [];

	if (end > start) {
		ops.push({
			type: "splice-text",
			blockId,
			from: start,
			to: end,
			insert: "",
		});
	}

	if (text.length > 0) {
		ops.push({
			type: "splice-text",
			blockId,
			from: start,
			to: start,
			insert: text,
		});
	}

	if (ops.length > 0) {
		editor.apply(ops, { origin: "user" });
	}

	const nextOffset = start + text.length;
	return {
		blockId,
		anchorOffset: nextOffset,
		focusOffset: nextOffset,
	};
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
