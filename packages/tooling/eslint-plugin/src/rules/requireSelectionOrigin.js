import {
	allowlistLifecycleListeners,
	allowlistSlots,
	loadAllowlistEntries,
	missingAllowlistField,
} from "./allowlistLint.js";
import { repoRelativeFilename } from "./lintPaths.js";
import { enclosingSymbol } from "./selectionLintShared.js";

/**
 * S3 (`spec/rules/selection.md`), W3.R11: every pen-dom and pen-undo
 * production call to an editor selection setter passes the options argument
 * that names its origin. The exceptions — host-API forwarding and
 * `FieldEditor.focus()` re-targeting, which default to `programmatic` on
 * purpose — are listed with a reason in
 * `scripts/selection-origin-allowlist.json`. An entry with no matching call
 * fails (I15), so the list only shrinks.
 */

const ALLOWLIST_PATH = "scripts/selection-origin-allowlist.json";
const REQUIRED_FIELDS = ["file", "symbol", "setter", "reason"];

/** Setter name → the argument count that includes `options`. */
export const SETTER_ARITY = new Map([
	["setSelection", 2],
	["selectBlock", 2],
	["selectBlocks", 2],
	["selectCell", 4],
	["selectCellRange", 4],
	["selectText", 4],
	["selectTextRange", 3],
	["selectAll", 2],
]);

/** Only editor receivers are setters; a scheduler's `setSelection(record)` is not. */
const EDITOR_RECEIVER = /(^|\.)(_?editor|ed)$/;

export function missingOriginAllowlistField(entry) {
	return missingAllowlistField(entry, REQUIRED_FIELDS);
}

export const requireSelectionOrigin = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Require an origin on pen-dom and pen-undo selection-setter calls (S3)",
			specRule: "S3",
		},
		schema: [
			{
				type: "object",
				properties: { allowlist: { type: "array" } },
				additionalProperties: false,
			},
		],
		messages: {
			originless:
				"`{{setter}}` in `{{symbol}}` ({{file}}) has no origin (S3). Pass `{ origin }`, or allowlist it with a reason.",
			incompleteAllowlist:
				"S3 selection-origin allowlist entry is missing `{{field}}`. Every entry needs file, symbol, setter and reason.",
			orphanedAllowlist:
				"S3 selection-origin allowlist entry for `{{api}}` in `{{symbol}}` ({{file}}) matches no call. Remove it (I15).",
		},
	},
	create(context) {
		const relative = repoRelativeFilename(
			context.filename ?? context.getFilename(),
		);
		const sourceCode = context.sourceCode ?? context.getSourceCode();
		const allowlist =
			context.options[0]?.allowlist ?? loadAllowlistEntries(ALLOWLIST_PATH);
		const slots = allowlistSlots(
			allowlist,
			relative,
			missingOriginAllowlistField,
		).map((slot) => ({ ...slot, api: slot.setter }));

		return {
			...allowlistLifecycleListeners(context, {
				allowlist,
				relative,
				slots,
				missingField: missingOriginAllowlistField,
			}),
			CallExpression(node) {
				const callee = node.callee;
				if (
					callee.type !== "MemberExpression" ||
					callee.computed ||
					callee.property.type !== "Identifier"
				) {
					return;
				}
				const setter = callee.property.name;
				const arity = SETTER_ARITY.get(setter);
				if (
					arity === undefined ||
					node.arguments.length >= arity ||
					!EDITOR_RECEIVER.test(sourceCode.getText(callee.object))
				) {
					return;
				}
				const symbol = enclosingSymbol(node);
				const slot = slots.find(
					(entry) => entry.symbol === symbol && entry.setter === setter,
				);
				if (slot) {
					slot.used = true;
					return;
				}
				context.report({
					node,
					messageId: "originless",
					data: { setter, symbol, file: relative },
				});
			},
		};
	},
};
