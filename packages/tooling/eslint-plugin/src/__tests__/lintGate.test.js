import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");

async function lintSeededViolation(
	code,
	fileName,
	packageDir = "packages/tooling/eslint-plugin",
) {
	const eslint = new ESLint({ cwd: repoRoot });
	const [result] = await eslint.lintText(code, {
		filePath: path.join(repoRoot, packageDir, fileName),
	});
	return result?.messages ?? [];
}

// The first lintText pays for loading the typed root config, which runs past
// Vitest's 5 s default on the Release runner.
describe("CH2 lint gate", { timeout: 60_000 }, () => {
	it("reports seeded markup injection as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			'const element: HTMLElement = document.body;\nelement.innerHTML = "<b>x</b>";\n',
			"seeded-injection.ts",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-html-injection-sinks" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded module-scope browser global as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"const title = document.title;\n",
			"seeded-module-scope-document.ts",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-module-scope-browser-globals" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded user-facing literal as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"export function Label() { return <button>Accept</button>; }\n",
			"src/seeded-literal.tsx",
			"packages/rendering/react",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-user-facing-literals" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports seeded aria-hidden on visible content as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			'export function Chip() { return <span aria-hidden="true" />;\n}\n',
			"src/seeded-aria-hidden.tsx",
			"packages/rendering/react",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-aria-hidden-visible" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports seeded outline none as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			'export const style = { outline: "none" };\n',
			"src/seeded-unstyled-focus.ts",
			"packages/rendering/react",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-unstyled-focus" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports seeded unescaped markup concat as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			'const html = `<img src="${src}" />`;\n',
			"src/seeded-markup-concat.ts",
			"packages/extensions/interop",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-unescaped-markup-concat" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded framework-free renderer module as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"export function leftover() { return 1; }\n",
			"src/seeded-framework-free.ts",
			"packages/rendering/react",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId ===
						"pen/no-framework-free-modules-in-renderers" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded v1 extension field as an error on a migrated package", async () => {
		const messages = await lintSeededViolation(
			'import { defineExtension } from "@input/pen-core";\nexport const ext = defineExtension({ name: "x", keyBindings: [] });\n',
			"src/seeded-v1-field.ts",
			"packages/extensions/snapshots",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-v1-extension-fields" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("still warns, not errors, on a decorations rider collectDecorations still reads", async () => {
		const messages = await lintSeededViolation(
			'import { defineExtension } from "@input/pen-core";\nexport const ext = defineExtension({ name: "x", decorations: () => empty });\n',
			"src/seeded-v1-decorations.ts",
			"packages/extensions/ai",
		);

		const hits = messages.filter(
			(message) => message.ruleId === "pen/no-v1-extension-fields",
		);
		expect(hits).toHaveLength(1);
		expect(hits[0]?.severity).toBe(1);
	});

	it("reports a seeded bare randomUUID as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"const id = crypto.randomUUID();\n",
			"src/seeded-random-uuid.ts",
			"packages/core",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-bare-random-uuid" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded implicit localeCompare as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"const order = left.localeCompare(right);\n",
			"src/seeded-implicit-locale.ts",
			"packages/core",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-implicit-locale" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports seeded ASCII word-boundary regex as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"const word = /\\bword\\b/;\n",
			"src/seeded-ascii-word.ts",
			"packages/extensions/search",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-ascii-word-boundaries" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded setTimeout in a *Selection* module the prefix matcher used to miss", async () => {
		const eslint = new ESLint({
			cwd: repoRoot,
			overrideConfig: {
				rules: { "pen/no-selection-timers": "error" },
			},
		});
		const [result] = await eslint.lintText("setTimeout(() => {}, 0);\n", {
			filePath: path.join(
				repoRoot,
				"packages/rendering/dom/src/field-editor/contenteditableBackendSelectionSeeded.ts",
			),
		});

		expect(
			(result?.messages ?? []).filter(
				(message) =>
					message.ruleId === "pen/no-selection-timers" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded setTimeout in a protected module the basename matcher used to miss", async () => {
		const eslint = new ESLint({
			cwd: repoRoot,
			overrideConfig: {
				rules: { "pen/no-selection-timers": "error" },
			},
		});
		const [result] = await eslint.lintText(
			"function seededS4Timer() { setTimeout(() => {}, 0); }\n",
			{
				filePath: path.join(
					repoRoot,
					"packages/core/src/selection/transitions.ts",
				),
			},
		);

		expect(
			(result?.messages ?? []).filter(
				(message) =>
					message.ruleId === "pen/no-selection-timers" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded setTimeout in a selection module when the rule is enabled", async () => {
		const eslint = new ESLint({
			cwd: repoRoot,
			overrideConfig: {
				rules: { "pen/no-selection-timers": "error" },
			},
		});
		const [result] = await eslint.lintText("setTimeout(() => {}, 0);\n", {
			filePath: path.join(
				repoRoot,
				"packages/rendering/dom/src/field-editor/selectionSeededTimer.ts",
			),
		});

		expect(
			(result?.messages ?? []).filter(
				(message) =>
					message.ruleId === "pen/no-selection-timers" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded matching-path case fold as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"const lower = query.toLowerCase();\n",
			"src/seeded-case-fold.ts",
			"packages/core",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-bare-case-folding" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded bare above-floor API as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"const copy = structuredClone(value);\n",
			"src/seeded-above-floor.ts",
			"packages/core",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-above-floor-api" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded unscheduled measure as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"function overlayPaint() { return el.getBoundingClientRect(); }\n",
			"src/seeded-measure.ts",
			"packages/rendering/dom",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-unscheduled-measure" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports seeded bidi-override as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			'export const style = { unicodeBidi: "bidi-override" };\n',
			"src/seeded-bidi.ts",
			"packages/rendering/dom",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-bidi-override" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports seeded JSON.stringify as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"function signature() { return JSON.stringify(summary); }\n",
			"src/seeded-stringify.ts",
			"packages/core",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-json-stringify-signatures" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded SelectionState property as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			"if (sel.isCollapsed) { return; }\n",
			"src/seeded-selection-props.ts",
			"packages/core",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-selection-state-properties" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded deep Pen import as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			'import { createEditor } from "@input/pen-core/src/editor";\n',
			"src/seeded-deep.ts",
			"packages/core",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-pen-deep-imports" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports a seeded above-floor API in a src deeper than packages/*/*/src", async () => {
		const messages = await lintSeededViolation(
			"const copy = structuredClone(value);\n",
			"src/seeded-above-floor.ts",
			"packages/tooling/conformance/harness",
		);

		expect(
			messages.filter(
				(message) =>
					message.ruleId === "pen/no-above-floor-api" &&
					message.severity === 2,
			),
		).toHaveLength(1);
	});

	it("reports seeded dynamic code as an error through the root config", async () => {
		const messages = await lintSeededViolation(
			'const run = new Function("return 1");\n',
			"seeded-dynamic-code.ts",
		);

		expect(messages.some((message) => message.severity === 2)).toBe(true);
	});
});
