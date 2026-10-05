import {
	allowlistLifecycleListeners,
	allowlistSlots,
	consumeAllowlistSlot,
	loadAllowlistEntries,
	missingAllowlistField as missingRequiredField,
} from "./allowlistLint.js";
import {
	enclosingSymbol,
	propertyName,
	repoRelativeFilename,
} from "./lintPaths.js";

/**
 * SCALE2 (`spec/rules/scale.md`): JSON.stringify is not a change-detection
 * signature in core or rendering runtime. Wire-format / display / clone
 * sites live on the allowlist.
 */

const ALLOWLIST_PATH = "scripts/json-stringify-allowlist.json";
const REQUIRED_FIELDS = ["file", "symbol", "reason"];

const committedAllowlist = loadAllowlistEntries(ALLOWLIST_PATH);

function missingAllowlistField(entry) {
	return missingRequiredField(entry, REQUIRED_FIELDS);
}

function isJsonStringify(node) {
	if (
		node.type !== "MemberExpression" &&
		node.type !== "OptionalMemberExpression"
	) {
		return false;
	}
	if (propertyName(node.property) !== "stringify") {
		return false;
	}
	return node.object.type === "Identifier" && node.object.name === "JSON";
}

export const noJsonStringifySignatures = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban JSON.stringify as a change-detection signature in core and rendering runtime",
			specRule: "SCALE2",
		},
		schema: [
			{
				type: "object",
				properties: { allowlist: { type: "array" } },
				additionalProperties: false,
			},
		],
		messages: {
			stringify:
				"`JSON.stringify` in `{{symbol}}` ({{file}}) is banned as a change signature (SCALE2). Use summary identity / version counters, or allowlist a wire-format / display / clone site with a reason.",
			incompleteAllowlist:
				"SCALE2 allowlist entry is missing `{{field}}`. Every entry must name file, symbol, and a reason.",
			unusedAllowlist:
				"SCALE2 allowlist entry for `{{symbol}}` in {{file}} was not consumed. Remove it in the same change that deleted the last stringify.",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const relative = repoRelativeFilename(filename);
		const allowlist = context.options[0]?.allowlist ?? committedAllowlist;
		const slots = allowlistSlots(allowlist, relative, missingAllowlistField);

		return {
			...allowlistLifecycleListeners(context, {
				allowlist,
				relative,
				slots,
				missingField: missingAllowlistField,
				orphanMessageId: "unusedAllowlist",
			}),
			CallExpression(node) {
				if (!isJsonStringify(node.callee)) {
					return;
				}
				const symbol = enclosingSymbol(node);
				if (consumeAllowlistSlot(slots, symbol)) {
					return;
				}
				context.report({
					node,
					messageId: "stringify",
					data: { symbol, file: relative },
				});
			},
		};
	},
};
