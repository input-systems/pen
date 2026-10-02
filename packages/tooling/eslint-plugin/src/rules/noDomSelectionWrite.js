import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * S1 (`spec/rules/selection.md`): one writer. In the renderer packages only
 * the selection projector mutates the DOM selection or an EditContext's
 * selection. Every other site is listed, with the requirement that removes
 * it, in `scripts/dom-selection-write-allowlist.json`; an entry whose site no
 * longer exists fails (I15), so the list only shrinks.
 */

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../..",
);
const DEFAULT_ALLOWLIST_PATH = path.join(REPO_ROOT, "scripts/dom-selection-write-allowlist.json");
const OWNER = "packages/rendering/dom/src/field-editor/selectionProjector.ts";
const SCOPES = [
	"packages/rendering/dom/src/",
	"packages/rendering/react/src/",
	"packages/rendering/vue/src/",
];

/** Selection mutators no other type shares. */
const ALWAYS = new Set([
	"removeAllRanges",
	"addRange",
	"setBaseAndExtent",
	"selectAllChildren",
	"collapseToStart",
	"collapseToEnd",
	"setPosition",
	"modify",
]);
/** Shared with Range or others: flagged only on a known Selection receiver. */
const ON_SELECTION = new Set(["extend", "collapse", "empty"]);
const REQUIRED_FIELDS = ["file", "symbol", "api", "reason", "closedBy"];

function loadAllowlist(filePath) {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return Array.isArray(parsed.entries) ? parsed.entries : [];
	} catch {
		return [];
	}
}

export function missingSelectionWriteField(entry) {
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

function isInScope(relative) {
	if (!SCOPES.some((scope) => relative.startsWith(scope))) return false;
	return !/(^|\/)__tests__\//.test(relative) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(relative);
}

function memberName(node) {
	if (node?.type !== "MemberExpression" || node.computed) return null;
	return node.property?.type === "Identifier" ? node.property.name : null;
}

function isGetSelectionCall(node) {
	if (node?.type !== "CallExpression") return false;
	const callee = node.callee;
	if (callee.type === "Identifier") return callee.name === "getSelection";
	return memberName(callee) === "getSelection";
}

function typeName(identifier) {
	const annotation = identifier?.typeAnnotation?.typeAnnotation;
	if (annotation?.type !== "TSTypeReference") return null;
	return annotation.typeName?.type === "Identifier" ? annotation.typeName.name : null;
}

const NAMED_KEY_TYPES = new Set(["MethodDefinition", "PropertyDefinition", "Property"]);

/** The name a scope node gives the code inside it, or null. */
function scopeName(node) {
	if (node.type === "FunctionDeclaration" || node.type === "VariableDeclarator") {
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

export const noDomSelectionWrite = {
	meta: {
		type: "problem",
		docs: {
			description: "Only the selection projector writes the DOM selection (S1)",
			specRule: "S1",
		},
		schema: [
			{
				type: "object",
				properties: { allowlist: { type: "array" } },
				additionalProperties: false,
			},
		],
		messages: {
			write:
				"`{{api}}` in `{{symbol}}` ({{file}}) writes the selection outside the projector (S1). Write the selection authority and let the projector project it, or add an allowlist entry naming the requirement that removes this site.",
			incompleteAllowlist:
				"S1 selection-write allowlist entry is missing `{{field}}`. Every entry needs file, symbol, api, reason and closedBy.",
			orphanedAllowlist:
				"S1 selection-write allowlist entry for `{{api}}` in `{{symbol}}` ({{file}}) has no matching write. Remove it in the change that moved the write (I15).",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const relative = repoRelative(filename);
		if (!isInScope(relative) || relative === OWNER) return {};
		const allowlist = context.options[0]?.allowlist ?? loadAllowlist(DEFAULT_ALLOWLIST_PATH);
		const slots = allowlist
			.filter((entry) => !missingSelectionWriteField(entry) && entry.file === relative)
			.map((entry) => ({ ...entry, used: false }));
		const selectionVariables = new Set();

		const isSelectionReceiver = (receiver) => {
			if (isGetSelectionCall(receiver)) return true;
			if (receiver?.type !== "Identifier") return false;
			return selectionVariables.has(receiver.name);
		};
		const isEditContextReceiver = (receiver) => {
			if (receiver?.type === "Identifier") return receiver.name === "editContext";
			return memberName(receiver) === "editContext";
		};
		const writtenApi = (callee) => {
			const name = memberName(callee);
			if (!name) return null;
			if (ALWAYS.has(name)) return name;
			if (ON_SELECTION.has(name) && isSelectionReceiver(callee.object)) return name;
			if (name === "updateSelection" && isEditContextReceiver(callee.object)) return name;
			return null;
		};
		const report = (node, api) => {
			const symbol = enclosingSymbol(node);
			const slot = slots.find((entry) => entry.symbol === symbol && entry.api === api);
			if (slot) {
				slot.used = true;
				return;
			}
			context.report({ node, messageId: "write", data: { api, symbol, file: relative } });
		};

		return {
			Program() {
				for (const entry of allowlist) {
					const field = missingSelectionWriteField(entry);
					if (field && (entry?.file === relative || field === "file")) {
						context.report({ loc: { line: 1, column: 0 }, messageId: "incompleteAllowlist", data: { field } });
					}
				}
			},
			VariableDeclarator(node) {
				if (node.id?.type === "Identifier" && isGetSelectionCall(node.init)) {
					selectionVariables.add(node.id.name);
				}
			},
			Identifier(node) {
				if (typeName(node) === "Selection") selectionVariables.add(node.name);
			},
			CallExpression(node) {
				const api = writtenApi(node.callee);
				if (api) report(node, api);
			},
			"Program:exit"() {
				for (const slot of slots.filter((entry) => !entry.used)) {
					context.report({
						loc: { line: 1, column: 0 },
						messageId: "orphanedAllowlist",
						data: { file: slot.file, symbol: slot.symbol, api: slot.api },
					});
				}
			},
		};
	},
};
