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
 * SCH1 (`spec/rules/dom.md`): geometry reads stay inside a scheduled
 * measure. Allowlisted symbols are the GeometryReader and justified
 * pre-scheduler sites.
 *
 * HB2 (`spec/rules/host.md`): the `extraNames` option adds layout metrics a
 * binding would need to rebuild a window or a height map. An extra name is
 * flagged as a property read (`el.scrollTop`, `window.getComputedStyle`), a
 * bare call (`getComputedStyle(el)`), or a construction
 * (`new ResizeObserver(…)`); a property write (`el.scrollTop = 0`) and a
 * type or feature-test mention are not measures. eslint.config.mjs turns it
 * on for the React and Vue bindings only, where layout belongs to pen-dom.
 */

const ALLOWLIST_PATH = "scripts/unscheduled-measure-allowlist.json";
const REQUIRED_FIELDS = ["file", "symbol", "reason"];

const MEASURE_NAMES = new Set([
	"getBoundingClientRect",
	"getClientRects",
	"elementFromPoint",
	"caretPositionFromPoint",
	"caretRangeFromPoint",
]);

const committedAllowlist = loadAllowlistEntries(ALLOWLIST_PATH);

export function missingAllowlistField(entry) {
	return missingRequiredField(entry, REQUIRED_FIELDS);
}

function isAssignmentTarget(node) {
	return (
		node.parent?.type === "AssignmentExpression" &&
		node.parent.operator === "=" &&
		node.parent.left === node
	);
}

/** The extra name `node` measures through, or null (HB2 `extraNames`). */
function extraMeasureName(node, extraNames) {
	if (node.type === "MemberExpression") {
		const name = propertyName(node.property);
		return extraNames.has(name) && !isAssignmentTarget(node) ? name : null;
	}
	const callee = node.callee;
	return callee?.type === "Identifier" && extraNames.has(callee.name)
		? callee.name
		: null;
}

function isMemberProperty(node) {
	const parent = node.parent;
	return (
		parent &&
		(parent.type === "MemberExpression" ||
			parent.type === "OptionalMemberExpression") &&
		parent.property === node
	);
}

export const noUnscheduledMeasure = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban unscheduled DOM geometry reads outside a measure phase",
			specRule: "SCH1",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowlist: { type: "array" },
					extraNames: { type: "array", items: { type: "string" } },
				},
				additionalProperties: false,
			},
		],
		messages: {
			measure:
				"`{{kind}}` in `{{symbol}}` ({{file}}) is an unscheduled measure (SCH1). Move it onto GeometryReader / measureNow or add an allowlist entry that names why it cannot.",
			incompleteAllowlist:
				"SCH1 allowlist entry is missing `{{field}}`. Every entry must name file, symbol, and a reason.",
			unusedAllowlist:
				"SCH1 allowlist entry for `{{symbol}}` in {{file}} was not consumed. Remove it in the same change that deleted the last measure.",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const relative = repoRelativeFilename(filename);
		const allowlist = context.options[0]?.allowlist ?? committedAllowlist;
		const extraNames = new Set(context.options[0]?.extraNames ?? []);
		const slots = allowlistSlots(allowlist, relative, missingAllowlistField);

		function reportMeasure(node, kind) {
			const symbol = enclosingSymbol(node);
			if (consumeAllowlistSlot(slots, symbol)) {
				return;
			}
			context.report({
				node,
				messageId: "measure",
				data: { kind, symbol, file: relative },
			});
		}

		function reportExtra(node) {
			const name = extraMeasureName(node, extraNames);
			if (name) {
				reportMeasure(node, name);
			}
		}

		return {
			...allowlistLifecycleListeners(context, {
				allowlist,
				relative,
				slots,
				missingField: missingAllowlistField,
				orphanMessageId: "unusedAllowlist",
			}),
			MemberExpression(node) {
				const kind = propertyName(node.property);
				if (MEASURE_NAMES.has(kind)) {
					reportMeasure(node, kind);
					return;
				}
				reportExtra(node);
			},
			CallExpression: reportExtra,
			NewExpression: reportExtra,
			Identifier(node) {
				if (
					MEASURE_NAMES.has(node.name) &&
					!isMemberProperty(node)
				) {
					reportMeasure(node, node.name);
				}
			},
		};
	},
};
