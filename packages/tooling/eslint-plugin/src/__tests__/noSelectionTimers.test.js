import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	isSelectionModule,
	missingAllowlistField,
	noSelectionTimers,
} from "../rules/noSelectionTimers.js";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const allowlistPath = path.join(
	import.meta.dirname,
	"../rules/no-selection-timers-allowlist.json",
);
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

// Synthetic sources keyed by a real selection-module path. Reading the actual
// file here is what made the previous version of this suite go red when the
// Firefox projection fix deleted the two rAFs it had pinned: the assertions
// describe the rule's behavior, not a tree state.
// The pair is derived from a live waiver rather than hardcoded. Hardcoding it
// reintroduced the same staleness one layer up: the end-of-write signal
// deleted `applySelectionUntilNextFrame`, and this suite — which exists to keep
// the rule honest — went red for naming the construct that retired.
const allowlistedEntry = allowlist.entries.find(
	(entry) => entry.kind === "requestAnimationFrame",
);
const authorityPath =
	allowlistedEntry?.file ??
	"packages/rendering/dom/src/field-editor/contenteditableBackend.ts";
const allowlistedSymbol =
	allowlistedEntry?.symbol ?? "scheduleActiveDOMMatchCheck";

const allowlistedRaf = `
function ${allowlistedSymbol}() {
	requestAnimationFrame(() => {
		void 0;
	});
}
`;

const allowlistedSymbolWithoutRaf = `
function ${allowlistedSymbol}() {
	void 0;
}
`;

function existingModulePaths() {
	return allowlist.modules.filter((file) => {
		const full = path.join(repoRoot, file);
		return file.includes("/") && existsSync(full);
	});
}

function outOfScopePaths() {
	return allowlist.outOfScope.map((entry) =>
		typeof entry === "string" ? entry : entry.file,
	);
}

describe("no-selection-timers (S4)", () => {
	it("treats the protected set as in scope and named non-selection files as out", () => {
		expect(isSelectionModule(authorityPath)).toBe(true);
		expect(
			isSelectionModule(
				"packages/rendering/dom/src/field-editor/selectionBridge.ts",
			),
		).toBe(true);
		expect(isSelectionModule("packages/core/src/editor/selection.ts")).toBe(
			true,
		);
		expect(isSelectionModule("packages/docs/src/pages/Selection.tsx")).toBe(
			true,
		);
		expect(
			isSelectionModule(
				"packages/rendering/dom/src/field-editor/contenteditableBackend.ts",
			),
		).toBe(true);
		expect(
			isSelectionModule(
				"packages/rendering/react/src/hooks/useSelectionToolbar.ts",
			),
		).toBe(true);
		expect(
			isSelectionModule(
				"packages/rendering/react/src/primitives/editor/inlineAtomSelectionInteraction.ts",
			),
		).toBe(true);
		expect(
			isSelectionModule(
				"packages/core/src/editor/editorSelectionMutations.ts",
			),
		).toBe(true);
		expect(
			isSelectionModule(
				"packages/rendering/dom/src/field-editor/fieldEditor.ts",
			),
		).toBe(false);
		expect(
			isSelectionModule(
				"packages/rendering/dom/src/__tests__/selectionBridge.test.ts",
			),
		).toBe(false);

		for (const file of existingModulePaths()) {
			expect(isSelectionModule(file)).toBe(true);
		}
		expect(
			isSelectionModule("packages/core/src/selection/transitions.ts"),
		).toBe(true);
		expect(
			isSelectionModule("packages/core/src/editor/caretPositions.ts"),
		).toBe(false);
		expect(
			isSelectionModule(
				"packages/rendering/dom/src/field-editor/selectionReader.ts",
			),
		).toBe(true);

		for (const file of outOfScopePaths()) {
			expect(isSelectionModule(file)).toBe(false);
		}
	});

	it("S4: every allowlist entry names file, symbol, kind, and a reason", () => {
		expect(allowlist.entries).toEqual([]);
		for (const entry of allowlist.entries) {
			expect(missingAllowlistField(entry)).toBeNull();
		}
	});

	it("S4: every allowlist file is in the protected set", () => {
		for (const entry of allowlist.entries) {
			expect(isSelectionModule(entry.file)).toBe(true);
		}
	});

	it("S4: every outOfScope entry names a file and a reason", () => {
		for (const entry of allowlist.outOfScope) {
			expect(typeof entry.file).toBe("string");
			expect(entry.file.length).toBeGreaterThan(0);
			expect(typeof entry.reason).toBe("string");
			expect(entry.reason.length).toBeGreaterThan(0);
			expect(isSelectionModule(entry.file)).toBe(false);
		}
	});

	// A waiver for a call that no longer exists is how this list turns into a
	// parking lot, and it is the exact drift that broke the previous suite.
	it("S4: every allowlist entry is still live in the file it names", () => {
		for (const entry of allowlist.entries) {
			const source = readFileSync(
				path.join(repoRoot, entry.file),
				"utf8",
			);
			expect(source).toContain(entry.kind);
			expect(source).toContain(entry.symbol);
		}
	});

	it("S4: a stale allowlist entry naming a file with no such timer fails liveness", () => {
		const stale = {
			file: "packages/core/src/editor/selection.ts",
			symbol: "ghostTimerThatDoesNotExist",
			kind: "setTimeout",
			reason: "stale entry for the liveness mutation",
		};
		const source = readFileSync(path.join(repoRoot, stale.file), "utf8");
		expect(
			source.includes(stale.kind) && source.includes(stale.symbol),
		).toBe(false);
		expect(() => {
			expect(source).toContain(stale.kind);
			expect(source).toContain(stale.symbol);
		}).toThrow();
	});

	it("bans timers in selection modules and honours the allowlist", () => {
		ruleTester.run("no-selection-timers", noSelectionTimers, {
			valid: [
				{
					code: "setTimeout(() => {}, 0);\n",
					filename:
						"packages/rendering/dom/src/field-editor/fieldEditor.ts",
				},
				{
					code: "setTimeout(() => {}, 0);\n",
					filename:
						"packages/rendering/dom/src/__tests__/selectionBridge.test.ts",
				},
				...(allowlistedEntry
					? [{ code: allowlistedRaf, filename: authorityPath }]
					: []),
			],
			invalid: [
				{
					code: "setTimeout(() => {}, 0);\n",
					filename:
						"packages/rendering/dom/src/field-editor/selectionBridge.ts",
					errors: [
						{
							messageId: "timer",
							data: {
								kind: "setTimeout",
								symbol: "(module)",
								file: "packages/rendering/dom/src/field-editor/selectionBridge.ts",
							},
						},
					],
				},
				{
					code: "requestAnimationFrame(() => {});\n",
					filename: "packages/core/src/editor/selection.ts",
					errors: [
						{
							messageId: "timer",
							data: {
								kind: "requestAnimationFrame",
								symbol: "(module)",
								file: "packages/core/src/editor/selection.ts",
							},
						},
					],
				},
				{
					code: "window.setImmediate(() => {});\n",
					filename:
						"packages/rendering/dom/src/field-editor/selectionProjector.ts",
					errors: [
						{
							messageId: "timer",
							data: {
								kind: "setImmediate",
								symbol: "(module)",
								file: "packages/rendering/dom/src/field-editor/selectionProjector.ts",
							},
						},
					],
				},
				{
					code: "setTimeout(() => {}, 0);\n",
					filename:
						"packages/rendering/dom/src/field-editor/selectionReader.ts",
					errors: [
						{
							messageId: "timer",
							data: {
								kind: "setTimeout",
								symbol: "(module)",
								file: "packages/rendering/dom/src/field-editor/selectionReader.ts",
							},
						},
					],
				},
				{
					code: "requestAnimationFrame(() => {});\n",
					filename:
						"packages/rendering/dom/src/field-editor/sessionReconciler.ts",
					errors: [
						{
							messageId: "timer",
							data: {
								kind: "requestAnimationFrame",
								symbol: "(module)",
								file: "packages/rendering/dom/src/field-editor/sessionReconciler.ts",
							},
						},
					],
				},
				...(allowlistedEntry
					? []
					: [
							{
								code: allowlistedRaf,
								filename: authorityPath,
								errors: [
									{
										messageId: "timer",
										data: {
											kind: "requestAnimationFrame",
											symbol: allowlistedSymbol,
											file: authorityPath,
										},
									},
								],
							},
						]),
				...(allowlistedEntry
					? [
							{
								code: `${allowlistedRaf}\nsetTimeout(() => {}, 16);\n`,
								filename: authorityPath,
								errors: [
									{
										messageId: "timer",
										data: {
											kind: "setTimeout",
											symbol: "(module)",
											file: authorityPath,
										},
									},
								],
							},
							{
								code: allowlistedSymbolWithoutRaf,
								filename: authorityPath,
								errors: [
									{
										messageId: "unusedAllowlist",
										data: {
											file: authorityPath,
											symbol: allowlistedSymbol,
											kind: "requestAnimationFrame",
										},
									},
								],
							},
						]
					: []),
			],
		});
	});

	it("the real allowlisted sources lint clean as committed", () => {
		for (const entry of allowlist.entries) {
			const source = readFileSync(
				path.join(repoRoot, entry.file),
				"utf8",
			);
			ruleTester.run(
				"no-selection-timers-production",
				noSelectionTimers,
				{
					valid: [{ code: source, filename: entry.file }],
					invalid: [],
				},
			);
		}
	});

	it("the real in-config module-list sources lint clean as committed", () => {
		for (const file of existingModulePaths()) {
			const source = readFileSync(path.join(repoRoot, file), "utf8");
			ruleTester.run("no-selection-timers-modules", noSelectionTimers, {
				valid: [{ code: source, filename: file }],
				invalid: [],
			});
		}
	});

	it("errors by name when an allowlisted selection module gains a new timer", () => {
		for (const entry of allowlist.entries) {
			const source = readFileSync(
				path.join(repoRoot, entry.file),
				"utf8",
			);
			const mutated = `${source}\nsetTimeout(() => { void 0; }, 0);\n`;
			expect(() => {
				ruleTester.run(
					"no-selection-timers-mutation",
					noSelectionTimers,
					{
						valid: [],
						invalid: [
							{
								code: mutated,
								filename: entry.file,
								errors: [
									{
										messageId: "timer",
										data: {
											kind: "setTimeout",
											symbol: "(module)",
											file: entry.file,
										},
									},
								],
							},
						],
					},
				);
			}).not.toThrow();
		}
	});

	it("errors by file and symbol when a newly-in-scope module gains a timer", () => {
		// A module only the explicit list brings in scope: its basename does
		// not contain `selection`.
		const file = "packages/core/src/selection/normalPosition.ts";
		expect(isSelectionModule(file)).toBe(true);
		expect(
			allowlist.entries.some((entry) => entry.file === file),
		).toBe(false);
		const mutated =
			"function seededS4Timer() {\n\tsetTimeout(() => { void 0; }, 0);\n}\n";
		ruleTester.run(
			"no-selection-timers-new-scope-mutation",
			noSelectionTimers,
			{
				valid: [],
				invalid: [
					{
						code: mutated,
						filename: file,
						errors: [
							{
								messageId: "timer",
								data: {
									kind: "setTimeout",
									symbol: "seededS4Timer",
									file,
								},
							},
						],
					},
				],
			},
		);
	});
	it("S4: overlay modules are selection modules", () => {
		const overlayModules = [
			"packages/rendering/dom/src/overlay/overlayController.ts",
			"packages/rendering/dom/src/overlay/overlayLayer.ts",
			"packages/rendering/dom/src/overlay/selectionOverlay.ts",
		];
		for (const file of overlayModules) {
			expect(isSelectionModule(file)).toBe(true);
			expect(
				allowlist.entries.some((entry) => entry.file === file),
			).toBe(false);
		}
		for (const file of overlayModules) {
			ruleTester.run("no-selection-timers-overlay", noSelectionTimers, {
				valid: [],
				invalid: [
					{
						code: "function seededOverlayTimer() {\n\tsetTimeout(() => { void 0; }, 0);\n}\n",
						filename: file,
						errors: [
							{
								messageId: "timer",
								data: {
									kind: "setTimeout",
									symbol: "seededOverlayTimer",
									file,
								},
							},
						],
					},
				],
			});
		}
	});

	it("S4: microtask, promise, async, await, setter-calling scheduler callbacks and retry counters are banned", () => {
		const file = "packages/rendering/dom/src/field-editor/focusController.ts";
		const error = (messageId, data) => ({ messageId, data: { file, ...data } });
		ruleTester.run("no-selection-timers-widened", noSelectionTimers, {
			valid: [
				{
					// A scheduler callback may call the projector (P3, scroll).
					code: "function scroll() {\n\tscheduler.write(() => projector.project());\n}\n",
					filename: file,
				},
				{
					// A counter declared inside the callback is not a retry.
					code: "function measure() {\n\tscheduler.read(() => {\n\t\tlet n = 3;\n\t\tn--;\n\t});\n}\n",
					filename: file,
				},
				{
					// R1: the reader's pointer-settled microtask changes window state only.
					code: 'function notifyGesture() {\n\tqueueMicrotask(() => {\n\t\twindows = nextGestureWindowState("pointer-settled", windows);\n\t});\n}\n',
					filename: "packages/rendering/dom/src/field-editor/selectionReader.ts",
				},
				{
					// Returning an already-settled promise is not a deferral.
					code: "function focusText() {\n\treturn Promise.resolve(true);\n}\n",
					filename: file,
				},
			],
			invalid: [
				{
					code: "function settle() {\n\tqueueMicrotask(() => {});\n}\n",
					filename: file,
					errors: [error("timer", { kind: "queueMicrotask", symbol: "settle" })],
				},
				{
					code: "function idle() {\n\trequestIdleCallback(() => {});\n}\n",
					filename: file,
					errors: [error("timer", { kind: "requestIdleCallback", symbol: "idle" })],
				},
				{
					code: "function later() {\n\tPromise.resolve().then(() => {});\n}\n",
					filename: file,
					errors: [error("promiseThen", { symbol: "later" })],
				},
				{
					code: "async function attach() {\n\tawait ready;\n}\n",
					filename: file,
					errors: [
						error("asyncFunction", { symbol: "attach" }),
						error("awaitExpression", { symbol: "attach" }),
					],
				},
				{
					code: "function project() {\n\tscheduler.write(() => editor.setSelection(next));\n}\n",
					filename: file,
					errors: [
						error("schedulerSetter", {
							phase: "write",
							setter: "setSelection",
							symbol: "project",
						}),
					],
				},
				{
					code: "function project() {\n\tgetRootGeometry(root).scheduler.read(() => {\n\t\tthis.activateTextSelection(id, 0, 0);\n\t});\n}\n",
					filename: file,
					errors: [
						error("schedulerSetter", {
							phase: "read",
							setter: "activateTextSelection",
							symbol: "project",
						}),
					],
				},
				{
					code: "function retry() {\n\tlet attempts = 3;\n\tscheduler.write(() => {\n\t\tif (attempts > 0) attempts--;\n\t});\n}\n",
					filename: file,
					errors: [error("retryCounter", { counter: "attempts", symbol: "retry" })],
				},
				{
					// The R1 shape outside the reader is an ordinary microtask.
					code: 'function notifyGesture() {\n\tqueueMicrotask(() => {\n\t\twindows = nextGestureWindowState("pointer-settled", windows);\n\t});\n}\n',
					filename: file,
					errors: [error("timer", { kind: "queueMicrotask", symbol: "notifyGesture" })],
				},
				{
					// An R1-shaped microtask that also writes selection is not R1.
					code: 'function notifyGesture() {\n\tqueueMicrotask(() => {\n\t\twindows = nextGestureWindowState("pointer-settled", windows);\n\t\teditor.setSelection(null);\n\t});\n}\n',
					filename: "packages/rendering/dom/src/field-editor/selectionReader.ts",
					errors: [
						{
							messageId: "timer",
							data: {
								kind: "queueMicrotask",
								symbol: "notifyGesture",
								file: "packages/rendering/dom/src/field-editor/selectionReader.ts",
							},
						},
					],
				},
			],
		});
	});
});
