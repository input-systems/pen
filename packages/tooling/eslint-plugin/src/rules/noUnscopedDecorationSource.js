import {
	allowlistLifecycleListeners,
	loadAllowlistEntries,
	missingAllowlistField,
} from "./allowlistLint.js";
import { repoRelativeFilename } from "./lintPaths.js";

/**
 * SCALE2 (`spec/rules/scale.md`): a function-form `decorationsFacet` source
 * is called on every commit and recomputed in full, so its cost is whatever
 * it reads. First-party sources use `scopedDecorationSource` unless their
 * cost is proportional to the extension's own state (presence, a visible
 * completion, a stream frontier). Those sites are listed, with a reason, in
 * `scripts/unscoped-decoration-source-allowlist.json`. An entry whose site no
 * longer exists fails (I15), so the list can only shrink with the code.
 */

const ALLOWLIST_PATH = "scripts/unscoped-decoration-source-allowlist.json";

const FUNCTION_TYPES = new Set([
	"FunctionExpression",
	"ArrowFunctionExpression",
]);
const REQUIRED_FIELDS = ["file", "symbol", "reason", "closedBy"];

export function missingDecorationAllowlistField(entry) {
	return missingAllowlistField(entry, REQUIRED_FIELDS);
}

function isDecorationsFacetOf(callee) {
	return (
		callee?.type === "MemberExpression" &&
		!callee.computed &&
		callee.object?.type === "Identifier" &&
		callee.object.name === "decorationsFacet" &&
		callee.property?.type === "Identifier" &&
		callee.property.name === "of"
	);
}

/** Nearest named function or variable around `node`; "(module)" at top level. */
function enclosingSymbol(node) {
	for (let current = node.parent; current; current = current.parent) {
		if (
			current.type === "FunctionDeclaration" &&
			current.id?.type === "Identifier"
		) {
			return current.id.name;
		}
		if (
			current.type === "VariableDeclarator" &&
			current.id?.type === "Identifier"
		) {
			return current.id.name;
		}
	}
	return "(module)";
}

export const noUnscopedDecorationSource = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Require scopedDecorationSource for decorationsFacet sources outside the allowlist",
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
			unscoped:
				"`decorationsFacet.of(<function>)` in `{{symbol}}` ({{file}}) recomputes in full on every commit (SCALE2). Use `scopedDecorationSource({ interest, decorate })`, or add an allowlist entry whose reason shows the cost follows the extension's own state.",
			incompleteAllowlist:
				"SCALE2 decoration-source allowlist entry is missing `{{field}}`. Every entry needs file, symbol, reason and closedBy.",
			orphanedAllowlist:
				"SCALE2 decoration-source allowlist entry for `{{symbol}}` in {{file}} has no function-form site. Remove it in the change that scoped or deleted the source (I15).",
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
					!missingDecorationAllowlistField(entry) &&
					entry.file === relative,
			)
			.map((entry) => ({ ...entry, used: false }));

		return {
			...allowlistLifecycleListeners(context, {
				allowlist,
				relative,
				slots,
				missingField: missingDecorationAllowlistField,
			}),
			CallExpression(node) {
				if (!isDecorationsFacetOf(node.callee)) return;
				if (!FUNCTION_TYPES.has(node.arguments[0]?.type)) return;
				const symbol = enclosingSymbol(node);
				const slot = slots.find(
					(entry) => !entry.used && entry.symbol === symbol,
				);
				if (slot) {
					slot.used = true;
					return;
				}
				context.report({
					node,
					messageId: "unscoped",
					data: { symbol, file: relative },
				});
			},
		};
	},
};
