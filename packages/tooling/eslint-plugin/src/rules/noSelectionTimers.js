import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * S4 (`spec/rules/selection.md`): selection modules must not defer with
 * `requestAnimationFrame`, `setTimeout`, `setInterval`, or `setImmediate`.
 * A timer in this path has repeatedly been a missing attach or a wrong seam,
 * not an engine accommodation.
 *
 * Scope is a decision, not a guess. Files whose basename contains
 * `selection` are in as a fail-closed net so a new `selectionReader.ts`
 * cannot silently escape. `modules` adds what that net cannot see: today
 * `contenteditableBackend.ts` and the fail-closed `caretPositions.ts`
 * basename. `focusController.ts`, `offsetDomain.ts`, and core
 * `transitions.ts` are not covered yet. Files that are legitimately not
 * selection code live in `outOfScope`, not in the allowlist — those mean
 * different things.
 */

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../..",
);
const DEFAULT_ALLOWLIST_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"no-selection-timers-allowlist.json",
);

const TIMER_NAMES = new Set([
	"requestAnimationFrame",
	"setTimeout",
	"setInterval",
	"setImmediate",
]);

const FUNCTION_TYPES = new Set([
	"FunctionDeclaration",
	"FunctionExpression",
	"ArrowFunctionExpression",
]);

function loadConfig(filePath) {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return {
			entries: Array.isArray(parsed.entries) ? parsed.entries : [],
			modules: Array.isArray(parsed.modules) ? parsed.modules : [],
			outOfScope: Array.isArray(parsed.outOfScope)
				? parsed.outOfScope
				: [],
		};
	} catch {
		return { entries: [], modules: [], outOfScope: [] };
	}
}

const committedConfig = loadConfig(DEFAULT_ALLOWLIST_PATH);
const committedAllowlist = committedConfig.entries;

export function missingAllowlistField(entry) {
	if (!entry || typeof entry !== "object") {
		return "file";
	}
	if (typeof entry.file !== "string" || entry.file.trim().length === 0) {
		return "file";
	}
	if (typeof entry.symbol !== "string" || entry.symbol.trim().length === 0) {
		return "symbol";
	}
	if (typeof entry.kind !== "string" || !TIMER_NAMES.has(entry.kind)) {
		return "kind";
	}
	if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
		return "reason";
	}
	return null;
}

function posixFilename(filename) {
	return filename.replace(/\\/g, "/");
}

function repoRelativeFilename(filename) {
	const normalized = posixFilename(filename);
	const root = posixFilename(REPO_ROOT);
	if (normalized.startsWith(`${root}/`)) {
		return normalized.slice(root.length + 1);
	}
	const packagesAt = normalized.lastIndexOf("/packages/");
	if (packagesAt !== -1) {
		return normalized.slice(packagesAt + 1);
	}
	if (normalized.startsWith("packages/")) {
		return normalized;
	}
	return normalized;
}

function isTestPath(filename) {
	const normalized = posixFilename(filename);
	return (
		normalized.includes("/__tests__/") ||
		/\.test\.[cm]?[jt]sx?$/.test(normalized) ||
		/\.spec\.[cm]?[jt]sx?$/.test(normalized)
	);
}

function pathFromListEntry(entry) {
	if (typeof entry === "string") {
		return entry;
	}
	if (entry && typeof entry === "object" && typeof entry.file === "string") {
		return entry.file;
	}
	return "";
}

function listHasPath(list, relative) {
	const base = relative.split("/").pop() ?? "";
	return list.some((entry) => {
		const item = posixFilename(pathFromListEntry(entry)).replace(
			/^\/+/,
			"",
		);
		if (item.length === 0) {
			return false;
		}
		return (
			relative === item || base === item || relative.endsWith(`/${item}`)
		);
	});
}

/**
 * A file is a selection module when it is production code and either
 * (1) its basename contains `selection` (the fail-closed net for the
 * files the selection redesign creates under that name) or (2) it is on the
 * explicit `modules` list (the decision for files that name cannot
 * see). `outOfScope` wins so a non-selection file can be named without
 * becoming an allowlist waiver.
 */
export function isSelectionModule(filename, options = {}) {
	if (isTestPath(filename)) {
		return false;
	}
	const relative = repoRelativeFilename(filename);
	const modules = options.modules ?? committedConfig.modules;
	const outOfScope = options.outOfScope ?? committedConfig.outOfScope;
	if (listHasPath(outOfScope, relative)) {
		return false;
	}
	if (listHasPath(modules, relative)) {
		return true;
	}
	const base = relative.split("/").pop() ?? "";
	return base.toLowerCase().includes("selection") && hasScriptExtension(base);
}

function hasScriptExtension(base) {
	const dot = base.lastIndexOf(".");
	if (dot === -1) {
		return false;
	}
	const ext = base.slice(dot + 1).toLowerCase();
	return (
		ext === "js" ||
		ext === "ts" ||
		ext === "jsx" ||
		ext === "tsx" ||
		ext === "cjs" ||
		ext === "cts" ||
		ext === "mjs" ||
		ext === "mts"
	);
}

function propertyName(node) {
	if (!node) {
		return null;
	}
	if (node.type === "Identifier") {
		return node.name;
	}
	if (node.type === "Literal" && typeof node.value === "string") {
		return node.value;
	}
	if (node.type === "PrivateIdentifier" || node.type === "PrivateName") {
		return `#${node.name}`;
	}
	return null;
}

function timerKind(node) {
	if (node.type === "Identifier" && TIMER_NAMES.has(node.name)) {
		return node.name;
	}
	if (
		(node.type === "MemberExpression" ||
			node.type === "OptionalMemberExpression") &&
		!node.computed
	) {
		const name = propertyName(node.property);
		if (name && TIMER_NAMES.has(name)) {
			return name;
		}
	}
	return null;
}

function enclosingSymbol(node) {
	let current = node.parent;
	while (current) {
		if (
			current.type === "FunctionDeclaration" &&
			current.id?.type === "Identifier"
		) {
			return current.id.name;
		}
		if (
			(current.type === "MethodDefinition" ||
				current.type === "PropertyDefinition" ||
				current.type === "Property") &&
			FUNCTION_TYPES.has(current.value?.type)
		) {
			return propertyName(current.key) ?? "(anonymous)";
		}
		if (
			current.type === "VariableDeclarator" &&
			current.id?.type === "Identifier" &&
			FUNCTION_TYPES.has(current.init?.type)
		) {
			return current.id.name;
		}
		current = current.parent;
	}
	return "(module)";
}

export const noSelectionTimers = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban requestAnimationFrame/setTimeout/setImmediate in selection modules",
			specRule: "S4",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowlist: { type: "array" },
					modules: { type: "array" },
					outOfScope: { type: "array" },
				},
				additionalProperties: false,
			},
		],
		messages: {
			timer: "`{{kind}}` in `{{symbol}}` ({{file}}) is banned (S4). A timer here is evidence of a missing attach or a wrong seam, not an engine accommodation. Delete it or add an allowlist entry with a reason (S4).",
			incompleteAllowlist:
				"S4 allowlist entry is missing `{{field}}`. Every entry must name file, symbol, kind, and a reason (S4).",
			unusedAllowlist:
				"S4 allowlist entry for `{{symbol}}` `{{kind}}` in {{file}} was not consumed. Remove it in the same change that deleted the timer (S4).",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const relative = repoRelativeFilename(filename);
		const allowlist = context.options[0]?.allowlist ?? committedAllowlist;
		const modules = context.options[0]?.modules ?? committedConfig.modules;
		const outOfScope =
			context.options[0]?.outOfScope ?? committedConfig.outOfScope;

		if (!isSelectionModule(filename, { modules, outOfScope })) {
			return {};
		}

		const slots = allowlist
			.filter((entry) => !missingAllowlistField(entry))
			.filter((entry) => posixFilename(entry.file) === relative)
			.map((entry) => ({ ...entry, used: false }));

		function consumeAllowlist(symbol, kind) {
			const slot = slots.find(
				(entry) =>
					!entry.used &&
					entry.symbol === symbol &&
					entry.kind === kind,
			);
			if (!slot) {
				return false;
			}
			slot.used = true;
			return true;
		}

		return {
			Program() {
				for (const entry of allowlist) {
					const field = missingAllowlistField(entry);
					if (field) {
						context.report({
							loc: { line: 1, column: 0 },
							messageId: "incompleteAllowlist",
							data: { field },
						});
					}
				}
			},
			"Program:exit"() {
				for (const slot of slots) {
					if (slot.used) {
						continue;
					}
					context.report({
						loc: { line: 1, column: 0 },
						messageId: "unusedAllowlist",
						data: {
							file: slot.file,
							symbol: slot.symbol,
							kind: slot.kind,
						},
					});
				}
			},
			CallExpression(node) {
				const kind = timerKind(node.callee);
				if (!kind) {
					return;
				}
				const symbol = enclosingSymbol(node);
				if (consumeAllowlist(symbol, kind)) {
					return;
				}
				context.report({
					node,
					messageId: "timer",
					data: { kind, symbol, file: relative },
				});
			},
		};
	},
};
