import {
	allowlistLifecycleListeners,
	loadAllowlistEntries,
	missingAllowlistField,
} from "./allowlistLint.js";
import { enclosingSymbol, propertyName, repoRelativeFilename } from "./lintPaths.js";

/**
 * HB2 (`spec/rules/host.md`): bindings stay glue. A per-block
 * `editor.on("commit" | "selectionChange", …)` in `@input/pen-react` or
 * `@input/pen-vue` re-runs for every block on every event; per-block state
 * goes through pen-dom's block notifier (`createBlockNotifier`, SCALE6), which
 * notifies only the blocks whose slice changed. Editor-level subscribers
 * (toolbars, menus, the block list, selection hooks) stay, each listed with
 * a reason in `scripts/binding-subscriptions-allowlist.json`. An entry may
 * carry `closedBy`, the requirement that removes it; an entry whose symbol no
 * longer subscribes fails (I15), so the list only shrinks with the code.
 */

const ALLOWLIST_PATH = "scripts/binding-subscriptions-allowlist.json";

const EDITOR_EVENTS = new Set(["commit", "selectionChange"]);
const REQUIRED_FIELDS = ["file", "symbol", "reason"];

export function missingSubscriptionAllowlistField(entry) {
	return missingAllowlistField(entry, REQUIRED_FIELDS);
}

/** Shorthand subscribe methods: `editor.onSelectionChange(cb)` is `on("selectionChange", cb)`. */
const SHORTHAND_EVENTS = new Map([["onSelectionChange", "selectionChange"]]);

/**
 * The event `node` subscribes to through `<expr>.on("<event>", …)` or a
 * shorthand such as `<expr>.onSelectionChange(…)`, or null.
 */
function subscribedEvent(node) {
	const callee = node.callee;
	if (callee?.type !== "MemberExpression" || callee.computed) return null;
	const method = propertyName(callee.property);
	if (method !== "on") return SHORTHAND_EVENTS.get(method) ?? null;
	const event = node.arguments[0];
	return event?.type === "Literal" && EDITOR_EVENTS.has(event.value)
		? event.value
		: null;
}

export const noBindingEditorSubscriptions = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban editor commit and selectionChange subscriptions in bindings outside the allowlist",
			specRule: "HB2",
		},
		schema: [
			{
				type: "object",
				properties: { allowlist: { type: "array" } },
				additionalProperties: false,
			},
		],
		messages: {
			subscription:
				"An editor `{{event}}` subscription in `{{symbol}}` ({{file}}) subscribes a binding to every editor {{event}} (HB2). Per-block state goes through the block notifier (`useBlockNotifier` / `subscribeBlock`); an editor-level subscriber needs an allowlist entry with a reason.",
			incompleteAllowlist:
				"HB2 binding-subscription allowlist entry is missing `{{field}}`. Every entry needs file, symbol and reason.",
			orphanedAllowlist:
				"HB2 binding-subscription allowlist entry for `{{symbol}}` in {{file}} has no editor subscription. Remove it in the change that deleted the subscription (I15).",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const relative = repoRelativeFilename(filename);
		const allowlist =
			context.options[0]?.allowlist ??
			loadAllowlistEntries(ALLOWLIST_PATH);
		const slots = allowlist
			.filter(
				(entry) =>
					!missingSubscriptionAllowlistField(entry) &&
					entry.file === relative,
			)
			.map((entry) => ({ ...entry, used: false }));

		return {
			...allowlistLifecycleListeners(context, {
				allowlist,
				relative,
				slots,
				missingField: missingSubscriptionAllowlistField,
			}),
			CallExpression(node) {
				const event = subscribedEvent(node);
				if (!event) return;
				const symbol = enclosingSymbol(node);
				const slot = slots.find((entry) => entry.symbol === symbol);
				if (slot) {
					slot.used = true;
					return;
				}
				context.report({
					node,
					messageId: "subscription",
					data: { event, symbol, file: relative },
				});
			},
		};
	},
};
