import type {
	Editor,
	DocumentOp,
	InputRule,
	InputRuleContext,
} from "@input/pen-types";
import { isCollapsed, supportsInlineInputRules } from "@input/pen-core";
import type { InlineInputRule } from "./types";

interface InputRuleMatchOptions {
	offset?: number;
}

// Core drops a conversion to a type the schema does not register but still
// applies the rule's trigger deletion, so a rule that converts to one must not
// fire.
function convertsToUnregisteredType(
	editor: Editor,
	ops: DocumentOp[],
): boolean {
	return ops.some((op) => {
		if (op.type !== "set-props" || typeof op.props.type !== "string") {
			return false;
		}

		const type = op.props.type;
		return !editor.schema
			.allBlocks()
			.some((schema) => schema.type === type);
	});
}

export class InputRuleEngine {
	private _rules: InputRule[] = [];
	private _inlineRules: InlineInputRule[] = [];

	register(rule: InputRule): void {
		const idx = this._rules.findIndex((r) => r.id === rule.id);
		if (idx >= 0) {
			this._rules[idx] = rule;
		} else {
			this._rules.push(rule);
		}
	}

	unregister(id: string): void {
		this._rules = this._rules.filter((r) => r.id !== id);
	}

	registerInline(rule: InlineInputRule): void {
		const idx = this._inlineRules.findIndex((r) => r.id === rule.id);
		if (idx >= 0) {
			this._inlineRules[idx] = rule;
		} else {
			this._inlineRules.push(rule);
		}
	}

	tryMatch(
		editor: Editor,
		blockId: string,
		insertedText: string,
		options: InputRuleMatchOptions = {},
	): DocumentOp[] | null {
		if (insertedText !== " " && insertedText !== "\n") return null;

		const handle = editor.getBlock(blockId);
		if (!handle) return null;

		const blockType = handle.type;
		const fullText = handle.textContent();
		const offset = this._resolveOffset(editor, blockId, options.offset);
		if (offset == null) return null;

		const textBefore = fullText.slice(0, offset) + insertedText;

		const ctx: InputRuleContext = {
			editor,
			blockId,
			blockType,
			textBefore,
			fullText,
		};

		for (const rule of this._rules) {
			if (rule.blockTypes && !rule.blockTypes.includes(blockType))
				continue;

			const match = textBefore.match(rule.match);
			if (!match) continue;

			const ops = rule.handler(match, ctx);
			if (!ops || ops.length === 0) continue;
			if (convertsToUnregisteredType(editor, ops)) continue;

			return ops;
		}

		return null;
	}

	/**
	 * Attempts to match an inline markdown pattern (e.g. **bold**, *italic*).
	 * Called when the user types the closing delimiter character.
	 */
	tryMatchInline(
		editor: Editor,
		blockId: string,
		insertedText: string,
		options: InputRuleMatchOptions = {},
	): DocumentOp[] | null {
		if (insertedText.length !== 1) return null;

		const handle = editor.getBlock(blockId);
		if (!handle) return null;

		const schema = editor.schema.resolve(handle.type);
		if (!supportsInlineInputRules(schema)) return null;

		const fullText = handle.textContent();
		const offset = this._resolveOffset(editor, blockId, options.offset);
		if (offset == null) return null;

		const textWithInsert =
			fullText.slice(0, offset) + insertedText + fullText.slice(offset);
		const cursorAfterInsert = offset + insertedText.length;

		for (const rule of this._inlineRules) {
			if (insertedText !== rule.trigger.slice(-1)) continue;

			if (!editor.schema.resolveInline(rule.markType)) continue;

			const match = rule.pattern.exec(textWithInsert);
			if (!match) continue;

			const matchEnd = match.index + match[0].length;
			if (matchEnd !== cursorAfterInsert) continue;

			const innerText = match[1];
			if (!innerText || innerText.length === 0) continue;

			const matchStart = match.index;
			const fullMatchLength = match[0].length;

			return [
				{
					type: "splice-text",
					blockId,
					from: matchStart,
					to: matchStart + fullMatchLength,
					insert: "",
				},
				{
					type: "splice-text",
					blockId,
					from: matchStart,
					to: matchStart,
					insert: innerText,
					marks: { [rule.markType]: true },
				},
			];
		}

		return null;
	}

	private _resolveOffset(
		editor: Editor,
		blockId: string,
		offsetOverride?: number,
	): number | null {
		if (typeof offsetOverride === "number") {
			return offsetOverride;
		}

		const sel = editor.selection;
		if (!sel || sel.type !== "text" || !isCollapsed(sel)) return null;
		if (sel.anchor.blockId !== blockId) return null;
		return sel.anchor.offset;
	}
}
