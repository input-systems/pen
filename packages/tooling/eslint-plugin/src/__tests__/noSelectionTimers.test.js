import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	isSelectionModule,
	noSelectionTimers,
	OUT_OF_SCOPE,
	SELECTION_MODULES,
} from "../rules/noSelectionTimers.js";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");

// Synthetic sources keyed by a real selection-module path: the assertions
// describe the rule's behavior, not a tree state.
const authorityPath =
	"packages/rendering/dom/src/field-editor/contenteditableBackend.ts";
const seededRaf = `
function scheduleActiveDOMMatchCheck() {
	requestAnimationFrame(() => {
		void 0;
	});
}
`;

function existingModulePaths() {
	return SELECTION_MODULES.filter((file) =>
		existsSync(path.join(repoRoot, file)),
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

		for (const file of OUT_OF_SCOPE) {
			expect(isSelectionModule(file)).toBe(false);
		}
	});

	it("bans timers in selection modules", () => {
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
				{
					code: seededRaf,
					filename: authorityPath,
					errors: [
						{
							messageId: "timer",
							data: {
								kind: "requestAnimationFrame",
								symbol: "scheduleActiveDOMMatchCheck",
								file: authorityPath,
							},
						},
					],
				},
			],
		});
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

	it("errors by file and symbol when a newly-in-scope module gains a timer", () => {
		// A module only the explicit list brings in scope: its basename does
		// not contain `selection`.
		const file = "packages/core/src/selection/normalPosition.ts";
		expect(isSelectionModule(file)).toBe(true);
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
