import { repoRelativeFilename } from "./lintPaths.js";

/**
 * Shared by the S1 selection lint pair (`no-dom-selection-write`,
 * `no-dom-selection-read`) and the focus rule: renderer scope and the
 * per-site report. Every site outside the owner is an error; there is no
 * allowlist.
 */

const SCOPES = [
	"packages/rendering/dom/src/",
	"packages/rendering/react/src/",
	"packages/rendering/vue/src/",
];
const NAMED_KEY_TYPES = new Set([
	"MethodDefinition",
	"PropertyDefinition",
	"Property",
]);

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
export function enclosingSymbol(node) {
	for (let current = node.parent; current; current = current.parent) {
		const name = scopeName(current);
		if (name) return name;
	}
	return "(module)";
}

/**
 * Rule metadata for one half of the S1 pair. `kind` is "read" or "write";
 * `violation` is the message for a site outside the owner.
 */
export function selectionLintMeta({ description, kind, violation }) {
	return {
		type: "problem",
		docs: { description, specRule: "S1" },
		schema: [],
		messages: { [kind]: violation },
	};
}

/**
 * The reporter for a renderer production file other than `owner`, or null
 * when the rule does not apply to this file. `report(node, api)` reports
 * `messageId` with the enclosing symbol.
 */
export function selectionLintReporter(context, { owner, messageId }) {
	const relative = rendererProductionPath(
		context.filename ?? context.getFilename(),
	);
	if (!relative || relative === owner) return null;
	return {
		file: relative,
		report(node, api) {
			context.report({
				node,
				messageId,
				data: { api, symbol: enclosingSymbol(node), file: relative },
			});
		},
	};
}
