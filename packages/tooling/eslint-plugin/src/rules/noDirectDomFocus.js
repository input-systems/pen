import { memberName, selectionLintTracker } from "./selectionLintShared.js";

/**
 * P focus paragraph (`spec/rules/selection.md`), W3.R16: focus is a
 * projection concern, and in `@input/pen-dom` only the focus controller
 * calls `HTMLElement.focus`. Calls on the field editor's own `focus()` API
 * (`this`, `fieldEditor`, `ctx.fieldEditor`, `this.fieldEditor`,
 * `options.fieldEditor`) are the API, not a DOM write. React and Vue chrome
 * focusing their own controls (AX3) is out of scope. Exceptions are listed
 * in `scripts/dom-focus-allowlist.json`; an entry with no matching call
 * fails (I15).
 */

const ALLOWLIST_PATH = "scripts/dom-focus-allowlist.json";
const OWNER = "packages/rendering/dom/src/field-editor/focusController.ts";
const DOM_SCOPE = "packages/rendering/dom/src/";
const FIELD_EDITOR_RECEIVERS = new Set([
	"this",
	"fieldEditor",
	"ctx.fieldEditor",
	"this.fieldEditor",
	"options.fieldEditor",
]);

function receiverText(node) {
	if (node?.type === "ThisExpression") return "this";
	if (node?.type === "Identifier") return node.name;
	if (node?.type === "MemberExpression" && !node.computed) {
		const object = receiverText(node.object);
		const property = memberName(node);
		return object && property ? `${object}.${property}` : null;
	}
	if (node?.type === "ChainExpression") return receiverText(node.expression);
	return null;
}

export const noDirectDomFocus = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Only the focus controller focuses DOM elements in pen-dom (P, W3.R16)",
			specRule: "P",
		},
		schema: [
			{
				type: "object",
				properties: { allowlist: { type: "array" } },
				additionalProperties: false,
			},
		],
		messages: {
			focus: "`{{api}}` in `{{symbol}}` ({{file}}) focuses a DOM element outside the focus controller (W3.R16). Route it through the field editor's `requestRootFocus`/`requestDomFocus`, or add an allowlist entry naming the requirement that removes it.",
			incompleteAllowlist:
				"Focus allowlist entry is missing `{{field}}`. Every entry needs file, symbol, api, reason and closedBy.",
			orphanedAllowlist:
				"Focus allowlist entry for `{{api}}` in `{{symbol}}` ({{file}}) has no matching call. Remove it in the change that moved the call (I15).",
		},
	},
	create(context) {
		const filename = (context.filename ?? context.getFilename()).replace(
			/\\/g,
			"/",
		);
		if (!filename.includes(DOM_SCOPE)) return {};
		const tracker = selectionLintTracker(context, {
			owner: OWNER,
			allowlistPath: ALLOWLIST_PATH,
			messageId: "focus",
		});
		if (!tracker) return {};
		return {
			...tracker.listeners,
			CallExpression(node) {
				const callee =
					node.callee.type === "ChainExpression"
						? node.callee.expression
						: node.callee;
				if (memberName(callee) !== "focus") return;
				if (FIELD_EDITOR_RECEIVERS.has(receiverText(callee.object))) return;
				tracker.report(node, "focus");
			},
		};
	},
};
