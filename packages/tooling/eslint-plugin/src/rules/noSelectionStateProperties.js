import { loadAllowlistEntries } from "./allowlistLint.js";
import {
	posixFilename,
	propertyName,
	repoRelativeFilename,
} from "./lintPaths.js";

/**
 * Selection-helper conversion (`spec/rules/selection.md`): SelectionState
 * receivers must not read isCollapsed / isMultiBlock / blockRange as
 * properties. Browser Selection and snapshot records are allowlisted.
 */

const ALLOWLIST_PATH = "scripts/selection-state-properties-allowlist.json";

const RECEIVERS = new Set(["selection", "sel", "nextSelection"]);
const PROPS = new Set(["isCollapsed", "isMultiBlock", "blockRange"]);

const committedAllowlist = loadAllowlistEntries(ALLOWLIST_PATH);

function receiverName(node) {
	if (node.type === "Identifier" && RECEIVERS.has(node.name)) {
		return node.name;
	}
	if (
		(node.type === "MemberExpression" ||
			node.type === "OptionalMemberExpression") &&
		RECEIVERS.has(propertyName(node.property))
	) {
		return propertyName(node.property);
	}
	return null;
}

export const noSelectionStateProperties = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban SelectionState property reads; use the core helpers",
			specRule: "selection",
		},
		schema: [
			{
				type: "object",
				properties: { allowlist: { type: "array" } },
				additionalProperties: false,
			},
		],
		messages: {
			property:
				"`{{construct}}` in {{file}} reads a SelectionState property. Use the core helpers, or allowlist the exact construct with a reason.",
			unusedAllowlist:
				"Selection-state allowlist entry for `{{construct}}` in {{file}} was not consumed. Remove it in the same change that deleted the access.",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const relative = repoRelativeFilename(filename);
		const sourceCode = context.sourceCode;
		const allowlist = context.options[0]?.allowlist ?? committedAllowlist;
		const slots = allowlist
			.filter(
				(entry) =>
					entry &&
					typeof entry.file === "string" &&
					typeof entry.construct === "string" &&
					posixFilename(entry.file) === relative,
			)
			.map((entry) => ({ ...entry, used: false }));

		function consume(construct) {
			const slot = slots.find((entry) => entry.construct === construct);
			if (!slot) {
				return false;
			}
			slot.used = true;
			return true;
		}

		return {
			"Program:exit"() {
				for (const slot of slots) {
					if (!slot.used) {
						context.report({
							loc: { line: 1, column: 0 },
							messageId: "unusedAllowlist",
							data: {
								file: slot.file,
								construct: slot.construct,
							},
						});
					}
				}
			},
			"MemberExpression, OptionalMemberExpression"(node) {
				const prop = propertyName(node.property);
				if (!PROPS.has(prop)) {
					return;
				}
				if (node.parent?.type === "CallExpression" && node.parent.callee === node) {
					return;
				}
				if (!receiverName(node.object)) {
					return;
				}
				const construct = sourceCode.getText(node);
				if (consume(construct)) {
					return;
				}
				context.report({
					node,
					messageId: "property",
					data: { construct, file: relative },
				});
			},
		};
	},
};
