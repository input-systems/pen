import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * SCALE2 (`spec/rules/scale.md`): a function-form `decorationsFacet` source
 * is called on every commit and recomputed in full, so its cost is whatever
 * it reads. First-party sources use `scopedDecorationSource` unless their
 * cost is proportional to the extension's own state (presence, a visible
 * completion, a stream frontier). Those sites are listed, with a reason, in
 * `scripts/unscoped-decoration-source-allowlist.json`. An entry whose site no
 * longer exists fails (I15), so the list can only shrink with the code.
 */

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../..",
);
const DEFAULT_ALLOWLIST_PATH = path.join(
	REPO_ROOT,
	"scripts/unscoped-decoration-source-allowlist.json",
);

const FUNCTION_TYPES = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
const REQUIRED_FIELDS = ["file", "symbol", "reason", "closedBy"];

function loadAllowlist(filePath) {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return Array.isArray(parsed.entries) ? parsed.entries : [];
	} catch {
		return [];
	}
}

export function missingDecorationAllowlistField(entry) {
	if (!entry || typeof entry !== "object") return "file";
	return (
		REQUIRED_FIELDS.find(
			(field) => typeof entry[field] !== "string" || entry[field].trim().length === 0,
		) ?? null
	);
}

function repoRelative(filename) {
	const normalized = filename.replace(/\\/g, "/");
	const root = REPO_ROOT.replace(/\\/g, "/");
	if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
	const packagesAt = normalized.lastIndexOf("/packages/");
	return packagesAt === -1 ? normalized : normalized.slice(packagesAt + 1);
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
		if (current.type === "FunctionDeclaration" && current.id?.type === "Identifier") {
			return current.id.name;
		}
		if (current.type === "VariableDeclarator" && current.id?.type === "Identifier") {
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
		const relative = repoRelative(filename);
		const allowlist = context.options[0]?.allowlist ?? loadAllowlist(DEFAULT_ALLOWLIST_PATH);
		const slots = allowlist
			.filter((entry) => !missingDecorationAllowlistField(entry) && entry.file === relative)
			.map((entry) => ({ ...entry, used: false }));

		return {
			Program() {
				for (const entry of allowlist) {
					const field = missingDecorationAllowlistField(entry);
					if (field && (entry?.file === relative || field === "file")) {
						context.report({
							loc: { line: 1, column: 0 },
							messageId: "incompleteAllowlist",
							data: { field },
						});
					}
				}
			},
			"Program:exit"() {
				for (const slot of slots.filter((entry) => !entry.used)) {
					context.report({
						loc: { line: 1, column: 0 },
						messageId: "orphanedAllowlist",
						data: { file: slot.file, symbol: slot.symbol },
					});
				}
			},
			CallExpression(node) {
				if (!isDecorationsFacetOf(node.callee)) return;
				if (!FUNCTION_TYPES.has(node.arguments[0]?.type)) return;
				const symbol = enclosingSymbol(node);
				const slot = slots.find((entry) => !entry.used && entry.symbol === symbol);
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
