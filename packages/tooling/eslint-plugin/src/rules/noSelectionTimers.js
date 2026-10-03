import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * S4 (`spec/rules/selection.md`): selection modules must not defer. Banned:
 * `requestAnimationFrame`, `setTimeout`, `setInterval`, `setImmediate`,
 * `requestIdleCallback`, `queueMicrotask`, a `Promise.resolve(…).then`
 * deferral, `async` functions and `await`, a scheduler callback
 * (`scheduler.read` / `scheduler.write`) that calls an authority setter, and
 * a retry counter (a `let` declared outside a scheduled callback and
 * decremented or compared inside it). A deferral in this path has
 * repeatedly been a missing attach or a wrong seam, not an engine
 * accommodation. A scheduler callback may call the projector (P3,
 * scroll-into-view); it may not call a setter.
 *
 * The one built-in exception is structural, not an allowlist entry: R1's
 * `queueMicrotask` in `field-editor/selectionReader.ts` whose callback
 * advances the gesture windows with `"pointer-settled"` and calls no
 * setter; it changes window state and writes nothing.
 *
 * Scope is a decision, not a guess. Files whose basename contains
 * `selection` are in as a fail-closed net so a new `selectionReader.ts`
 * cannot silently escape. `modules` adds what that net cannot see. Files
 * that are legitimately not selection code live in `outOfScope`, not in the
 * allowlist — those mean different things.
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
	"requestIdleCallback",
	"queueMicrotask",
]);

/** Allowlist kinds beyond the timer names, one per non-timer pattern. */
const PATTERN_KINDS = new Set([
	"promise-then",
	"async",
	"await",
	"scheduler-setter",
	"retry-counter",
]);

const SCHEDULER_PHASES = new Set(["read", "write"]);

/** Authority setters a scheduler callback must not call (S4). */
const AUTHORITY_SETTERS = new Set([
	"setSelection",
	"selectText",
	"selectTextRange",
	"selectBlocks",
	"selectCell",
	"selectCells",
	"activateTextSelection",
	"commitProgrammaticTextSelection",
	"collapseSelectionToStart",
	"collapseSelectionToEnd",
	"applyDocumentTextSelection",
	"applyDomTextSelection",
	"focusTextSelection",
	"activateCell",
	"activateCellEditing",
	"activateCellSelection",
]);

const AUTHORITY_SETTER_PREFIXES = ["collapseSelectionTo", "activateCell"];

const R1_READER_FILE = "packages/rendering/dom/src/field-editor/selectionReader.ts";
const R1_GESTURE = "pointer-settled";

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
	if (
		typeof entry.kind !== "string" ||
		!(TIMER_NAMES.has(entry.kind) || PATTERN_KINDS.has(entry.kind))
	) {
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

function isFunctionNode(node) {
	return node != null && FUNCTION_TYPES.has(node.type);
}

function isPromiseResolveCall(node) {
	return (
		node?.type === "CallExpression" &&
		(node.callee.type === "MemberExpression" ||
			node.callee.type === "OptionalMemberExpression") &&
		!node.callee.computed &&
		node.callee.object.type === "Identifier" &&
		node.callee.object.name === "Promise" &&
		propertyName(node.callee.property) === "resolve"
	);
}

/** `Promise.resolve(…).then(…)`: a microtask deferral spelled differently. */
function isPromiseThenDeferral(callee) {
	return (
		(callee.type === "MemberExpression" ||
			callee.type === "OptionalMemberExpression") &&
		!callee.computed &&
		propertyName(callee.property) === "then" &&
		isPromiseResolveCall(callee.object)
	);
}

function endsWithScheduler(node) {
	if (!node) {
		return false;
	}
	if (node.type === "Identifier") {
		return node.name === "scheduler" || node.name === "_scheduler";
	}
	if (
		(node.type === "MemberExpression" ||
			node.type === "OptionalMemberExpression") &&
		!node.computed
	) {
		const name = propertyName(node.property);
		return name === "scheduler" || name === "_scheduler";
	}
	if (node.type === "CallExpression") {
		// `this._options.getScheduler?.()` and friends.
		const name = propertyName(
			node.callee.type === "MemberExpression" ||
				node.callee.type === "OptionalMemberExpression"
				? node.callee.property
				: node.callee,
		);
		return name === "getScheduler";
	}
	return false;
}

/** `scheduler.read(cb)` / `scheduler.write(cb)` / `getRootGeometry(…).scheduler.write(cb)`. */
function schedulerPhase(callee) {
	if (
		(callee.type !== "MemberExpression" &&
			callee.type !== "OptionalMemberExpression") ||
		callee.computed
	) {
		return null;
	}
	const phase = propertyName(callee.property);
	if (!phase || !SCHEDULER_PHASES.has(phase)) {
		return null;
	}
	return endsWithScheduler(callee.object) ? phase : null;
}

function isAuthoritySetterName(name) {
	return (
		name != null &&
		(AUTHORITY_SETTERS.has(name) ||
			AUTHORITY_SETTER_PREFIXES.some((prefix) => name.startsWith(prefix)))
	);
}

function calledName(callee) {
	if (callee.type === "Identifier") {
		return callee.name;
	}
	if (
		(callee.type === "MemberExpression" ||
			callee.type === "OptionalMemberExpression") &&
		!callee.computed
	) {
		return propertyName(callee.property);
	}
	return null;
}

/** Visits `node`'s subtree without entering nested functions. */
function walkDirect(node, visit) {
	if (!node || typeof node.type !== "string") {
		return;
	}
	visit(node);
	for (const key of Object.keys(node)) {
		if (key === "parent") {
			continue;
		}
		const value = node[key];
		const children = Array.isArray(value) ? value : [value];
		for (const child of children) {
			if (
				child &&
				typeof child.type === "string" &&
				!isFunctionNode(child)
			) {
				walkDirect(child, visit);
			}
		}
	}
}

function callbackBody(fn) {
	return fn.body;
}

/** R1's one structural exception: the reader's `pointer-settled` microtask. */
function isR1PointerSettled(relative, node) {
	if (relative !== R1_READER_FILE) {
		return false;
	}
	const callback = node.arguments[0];
	if (!isFunctionNode(callback)) {
		return false;
	}
	let settles = false;
	let writes = false;
	walkDirect(callbackBody(callback), (inner) => {
		if (inner.type !== "CallExpression") {
			return;
		}
		if (isAuthoritySetterName(calledName(inner.callee))) {
			writes = true;
		}
		if (
			inner.arguments.some(
				(argument) => argument.type === "Literal" && argument.value === R1_GESTURE,
			)
		) {
			settles = true;
		}
	});
	return settles && !writes;
}

function letBindingOutside(scopeManagerScope, identifier, callback) {
	let scope = scopeManagerScope;
	while (scope) {
		const variable = scope.set?.get(identifier.name);
		if (variable) {
			const definition = variable.defs[0];
			if (
				definition?.type !== "Variable" ||
				definition.parent?.kind !== "let"
			) {
				return false;
			}
			const declared = definition.name;
			return !(
				declared.range[0] >= callback.range[0] &&
				declared.range[1] <= callback.range[1]
			);
		}
		scope = scope.upper;
	}
	return false;
}

const COMPARISON_OPERATORS = new Set(["<", "<=", ">", ">=", "===", "!==", "==", "!="]);

export const noSelectionTimers = {
	meta: {
		type: "problem",
		docs: {
			description:
				"Ban timers, microtask and promise deferrals, async/await, setter-calling scheduler callbacks, and retry counters in selection modules",
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
			promiseThen:
				"`Promise.resolve().then` in `{{symbol}}` ({{file}}) is a microtask deferral and is banned (S4). Delete it or add an allowlist entry with kind `promise-then` (S4).",
			asyncFunction:
				"`async` function `{{symbol}}` ({{file}}) defers a selection path and is banned (S4). Delete it or add an allowlist entry with kind `async` (S4).",
			awaitExpression:
				"`await` in `{{symbol}}` ({{file}}) defers a selection path and is banned (S4). Delete it or add an allowlist entry with kind `await` (S4).",
			schedulerSetter:
				"`scheduler.{{phase}}` callback in `{{symbol}}` ({{file}}) calls the authority setter `{{setter}}` (S4). A scheduler callback may call the projector, never a setter.",
			retryCounter:
				"`{{counter}}` is a retry counter in a scheduled callback in `{{symbol}}` ({{file}}) (S4). Retries are banned; attach the target the write is aimed at.",
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

		const sourceCode = context.sourceCode ?? context.getSourceCode();

		function enclosingSymbolOf(fn) {
			const parent = fn.parent;
			if (parent?.type === "VariableDeclarator" && parent.id?.type === "Identifier") {
				return parent.id.name;
			}
			if (
				(parent?.type === "MethodDefinition" ||
					parent?.type === "Property" ||
					parent?.type === "PropertyDefinition") &&
				parent.value === fn
			) {
				return propertyName(parent.key) ?? "(anonymous)";
			}
			return enclosingSymbol(fn);
		}

		function checkSchedulerCallback(node, phase) {
			const callback = node.arguments[0];
			if (!isFunctionNode(callback)) {
				return;
			}
			walkDirect(callbackBody(callback), (inner) => {
				if (inner.type !== "CallExpression") {
					return;
				}
				const setter = calledName(inner.callee);
				if (!isAuthoritySetterName(setter)) {
					return;
				}
				const symbol = enclosingSymbol(node);
				if (consumeAllowlist(symbol, "scheduler-setter")) {
					return;
				}
				context.report({
					node: inner,
					messageId: "schedulerSetter",
					data: { phase, setter, symbol, file: relative },
				});
			});
		}

		/** A `let` from outside a scheduled callback, decremented or compared inside it. */
		function checkRetryCounters(node) {
			const callback = node.arguments.find(isFunctionNode);
			if (!callback) {
				return;
			}
			const scope = sourceCode.getScope(callback);
			const reported = new Set();
			const report = (identifier) => {
				if (
					identifier?.type !== "Identifier" ||
					reported.has(identifier.name) ||
					!letBindingOutside(scope, identifier, callback)
				) {
					return;
				}
				reported.add(identifier.name);
				const symbol = enclosingSymbol(node);
				if (consumeAllowlist(symbol, "retry-counter")) {
					return;
				}
				context.report({
					node: identifier,
					messageId: "retryCounter",
					data: { counter: identifier.name, symbol, file: relative },
				});
			};
			walkDirect(callbackBody(callback), (inner) => {
				if (inner.type === "UpdateExpression" && inner.operator === "--") {
					report(inner.argument);
				} else if (
					inner.type === "AssignmentExpression" &&
					inner.operator === "-="
				) {
					report(inner.left);
				} else if (
					inner.type === "BinaryExpression" &&
					COMPARISON_OPERATORS.has(inner.operator) &&
					(inner.left.type === "Literal" || inner.right.type === "Literal") &&
					(typeof inner.left.value === "number" ||
						typeof inner.right.value === "number")
				) {
					report(inner.left.type === "Identifier" ? inner.left : inner.right);
				}
			});
		}

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
				if (kind) {
					if (kind === "queueMicrotask" && isR1PointerSettled(relative, node)) {
						checkRetryCounters(node);
						return;
					}
					const symbol = enclosingSymbol(node);
					checkRetryCounters(node);
					if (consumeAllowlist(symbol, kind)) {
						return;
					}
					context.report({
						node,
						messageId: "timer",
						data: { kind, symbol, file: relative },
					});
					return;
				}
				if (isPromiseThenDeferral(node.callee)) {
					const symbol = enclosingSymbol(node);
					if (!consumeAllowlist(symbol, "promise-then")) {
						context.report({
							node,
							messageId: "promiseThen",
							data: { symbol, file: relative },
						});
					}
					return;
				}
				const phase = schedulerPhase(node.callee);
				if (phase) {
					checkSchedulerCallback(node, phase);
					checkRetryCounters(node);
				}
			},
			":function[async=true]"(node) {
				const symbol =
					node.type === "FunctionDeclaration" && node.id
						? node.id.name
						: enclosingSymbolOf(node);
				if (consumeAllowlist(symbol, "async")) {
					return;
				}
				context.report({
					node,
					messageId: "asyncFunction",
					data: { symbol, file: relative },
				});
			},
			AwaitExpression(node) {
				const symbol = enclosingSymbol(node);
				if (consumeAllowlist(symbol, "await")) {
					return;
				}
				context.report({
					node,
					messageId: "awaitExpression",
					data: { symbol, file: relative },
				});
			},
		};
	},
};
