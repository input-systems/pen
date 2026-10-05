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

/** One invalid case: `code` in `filename` reports a single `kind` timer in `symbol`. */
function timerCase(code, filename, kind, symbol = "(module)") {
	return {
		code,
		filename,
		errors: [{ messageId: "timer", data: { kind, symbol, file: filename } }],
	};
}

const seededTimer = (symbol) =>
	`function ${symbol}() {\n\tsetTimeout(() => { void 0; }, 0);\n}\n`;

describe("no-selection-timers (S4)", () => {
	it.each([
		[authorityPath, true],
		["packages/rendering/dom/src/field-editor/selectionBridge.ts", true],
		["packages/core/src/editor/selection.ts", true],
		["packages/docs/src/pages/Selection.tsx", true],
		["packages/rendering/react/src/hooks/useSelectionToolbar.ts", true],
		[
			"packages/rendering/react/src/primitives/editor/inlineAtomSelectionInteraction.ts",
			true,
		],
		["packages/core/src/editor/editorSelectionMutations.ts", true],
		["packages/core/src/selection/transitions.ts", true],
		["packages/rendering/dom/src/field-editor/selectionReader.ts", true],
		// A module only the explicit list brings in scope.
		["packages/core/src/selection/normalPosition.ts", true],
		// S4: overlay modules are selection modules.
		["packages/rendering/dom/src/overlay/overlayController.ts", true],
		["packages/rendering/dom/src/overlay/overlayLayer.ts", true],
		["packages/rendering/dom/src/overlay/selectionOverlay.ts", true],
		["packages/rendering/dom/src/field-editor/fieldEditor.ts", false],
		["packages/rendering/dom/src/__tests__/selectionBridge.test.ts", false],
		["packages/core/src/editor/caretPositions.ts", false],
	])("S4: isSelectionModule(%s) is %s", (file, expected) => {
		expect(isSelectionModule(file)).toBe(expected);
	});

	it("S4: every listed module is in scope and every out-of-scope file is out", () => {
		for (const file of existingModulePaths()) {
			expect(isSelectionModule(file)).toBe(true);
		}
		for (const file of OUT_OF_SCOPE) {
			expect(isSelectionModule(file)).toBe(false);
		}
	});

	it("bans timers in selection modules, by file and symbol", () => {
		const moduleTimer = "setTimeout(() => {}, 0);\n";
		const moduleRaf = "requestAnimationFrame(() => {});\n";
		ruleTester.run("no-selection-timers", noSelectionTimers, {
			valid: [
				{
					code: moduleTimer,
					filename: "packages/rendering/dom/src/field-editor/fieldEditor.ts",
				},
				{
					code: moduleTimer,
					filename:
						"packages/rendering/dom/src/__tests__/selectionBridge.test.ts",
				},
			],
			invalid: [
				timerCase(
					moduleTimer,
					"packages/rendering/dom/src/field-editor/selectionBridge.ts",
					"setTimeout",
				),
				timerCase(moduleRaf, "packages/core/src/editor/selection.ts", "requestAnimationFrame"),
				timerCase(
					"window.setImmediate(() => {});\n",
					"packages/rendering/dom/src/field-editor/selectionProjector.ts",
					"setImmediate",
				),
				timerCase(
					moduleTimer,
					"packages/rendering/dom/src/field-editor/selectionReader.ts",
					"setTimeout",
				),
				timerCase(
					moduleRaf,
					"packages/rendering/dom/src/field-editor/sessionReconciler.ts",
					"requestAnimationFrame",
				),
				timerCase(seededRaf, authorityPath, "requestAnimationFrame", "scheduleActiveDOMMatchCheck"),
				// A module only the explicit list brings in scope.
				timerCase(
					seededTimer("seededS4Timer"),
					"packages/core/src/selection/normalPosition.ts",
					"setTimeout",
					"seededS4Timer",
				),
				...[
					"packages/rendering/dom/src/overlay/overlayController.ts",
					"packages/rendering/dom/src/overlay/overlayLayer.ts",
					"packages/rendering/dom/src/overlay/selectionOverlay.ts",
				].map((file) =>
					timerCase(seededTimer("seededOverlayTimer"), file, "setTimeout", "seededOverlayTimer"),
				),
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
				// An R1-shaped microtask that also writes selection is not R1.
				timerCase(
					'function notifyGesture() {\n\tqueueMicrotask(() => {\n\t\twindows = nextGestureWindowState("pointer-settled", windows);\n\t\teditor.setSelection(null);\n\t});\n}\n',
					"packages/rendering/dom/src/field-editor/selectionReader.ts",
					"queueMicrotask",
					"notifyGesture",
				),
			],
		});
	});
});
