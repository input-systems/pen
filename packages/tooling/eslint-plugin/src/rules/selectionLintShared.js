import {
	allowlistLifecycleListeners,
	loadAllowlistEntries,
	missingAllowlistField,
} from "./allowlistLint.js";
import { repoRelativeFilename } from "./lintPaths.js";

/**
 * Shared by the S1 selection lint pair (`no-dom-selection-write`,
 * `no-dom-selection-read`): renderer scope, the `{file, symbol, api, reason,
 * closedBy}` allowlist, and the per-symbol slot accounting that fails an
 * unconsumed entry (I15).
 */

const SCOPES = [
	"packages/rendering/dom/src/",
	"packages/rendering/react/src/",
	"packages/rendering/vue/src/",
];
const REQUIRED_FIELDS = ["file", "symbol", "api", "reason", "closedBy"];
const NAMED_KEY_TYPES = new Set([
	"MethodDefinition",
	"PropertyDefinition",
	"Property",
]);

export function missingSelectionLintField(entry) {
	return missingAllowlistField(entry, REQUIRED_FIELDS);
}

/** Repo-relative path when `filename` is a renderer production source, else null. */
function rendererProductionPath(filename) {
	const relative = repoRelativeFilename(filename);
	if (!SCOPES.some((scope) => relative.startsWith(scope))) return null;
	if (
		/(^|\/)__tests__\//.test(relative) ||
		/\.(test|spec)\.[cm]?[jt]sx?$/.test(relative)
	) {
		return null;
	}
	return relative;
}

export function memberName(node) {
	if (node?.type !== "MemberExpression" || node.computed) return null;
	return node.property?.type === "Identifier" ? node.property.name : null;
}

export function isGetSelectionCall(node) {
	if (node?.type !== "CallExpression") return false;
	const callee = node.callee;
	if (callee.type === "Identifier") return callee.name === "getSelection";
	return memberName(callee) === "getSelection";
}

/** The name a scope node gives the code inside it, or null. */
function scopeName(node) {
	if (
		node.type === "FunctionDeclaration" ||
		node.type === "VariableDeclarator"
	) {
		return node.id?.type === "Identifier" ? node.id.name : null;
	}
	if (NAMED_KEY_TYPES.has(node.type)) {
		return node.key?.type === "Identifier" ? node.key.name : null;
	}
	return null;
}

/** Nearest named function, method or variable around `node`; "(module)" at top level. */
function enclosingSymbol(node) {
	for (let current = node.parent; current; current = current.parent) {
		const name = scopeName(current);
		if (name) return name;
	}
	return "(module)";
}

/**
 * Allowlist accounting for one file. `report(node, api)` consumes a matching
 * `{symbol, api}` entry or reports `messageId`; `listeners` reports
 * incomplete entries on entry and unconsumed ones on exit.
 */
function createSelectionAllowlistTracker(
	context,
	relative,
	allowlist,
	messageId,
) {
	const slots = allowlist
		.filter(
			(entry) =>
				!missingSelectionLintField(entry) && entry.file === relative,
		)
		.map((entry) => ({ ...entry, used: false }));
	const report = (node, api) => {
		const symbol = enclosingSymbol(node);
		const slot = slots.find(
			(entry) => entry.symbol === symbol && entry.api === api,
		);
		if (slot) {
			slot.used = true;
			return;
		}
		context.report({
			node,
			messageId,
			data: { api, symbol, file: relative },
		});
	};
	const listeners = allowlistLifecycleListeners(context, {
		allowlist,
		relative,
		slots,
		missingField: missingSelectionLintField,
	});
	return { report, listeners, file: relative };
}

/**
 * Rule metadata for one half of the S1 pair. `kind` is "read" or "write";
 * `violation` is the message for an unlisted site.
 */
export function selectionLintMeta({ description, kind, violation }) {
	return {
		type: "problem",
		docs: { description, specRule: "S1" },
		schema: [
			{
				type: "object",
				properties: { allowlist: { type: "array" } },
				additionalProperties: false,
			},
		],
		messages: {
			[kind]: violation,
			incompleteAllowlist: `S1 selection-${kind} allowlist entry is missing \`{{field}}\`. Every entry needs file, symbol, api, reason and closedBy.`,
			orphanedAllowlist: `S1 selection-${kind} allowlist entry for \`{{api}}\` in \`{{symbol}}\` ({{file}}) has no matching ${kind}. Remove it in the change that moved the ${kind} (I15).`,
		},
	};
}

/**
 * The tracker for a renderer production file other than `owner`, or null
 * when the rule does not apply to this file.
 */
export function selectionLintTracker(
	context,
	{ owner, allowlistPath, messageId },
) {
	const relative = rendererProductionPath(
		context.filename ?? context.getFilename(),
	);
	if (!relative || relative === owner) return null;
	const allowlist =
		context.options[0]?.allowlist ?? loadAllowlistEntries(allowlistPath);
	return createSelectionAllowlistTracker(
		context,
		relative,
		allowlist,
		messageId,
	);
}
