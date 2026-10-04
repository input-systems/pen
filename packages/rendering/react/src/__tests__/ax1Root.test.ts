// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { EditorRoot } from "../primitives/editor/root";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestEditor() {
	return createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

const fixtures: Array<{
	container: HTMLElement;
	editor: ReturnType<typeof createTestEditor>;
	root: ReturnType<typeof createRoot>;
}> = [];

async function renderRoot(readonly = false) {
	const editor = createTestEditor();
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(createElement(EditorRoot, { editor, readonly }));
	});

	const fixture = { container, editor, root };
	fixtures.push(fixture);
	return fixture;
}

afterEach(async () => {
	while (fixtures.length > 0) {
		const fixture = fixtures.pop();
		if (!fixture) {
			break;
		}
		await act(async () => {
			fixture.root.unmount();
		});
		fixture.container.remove();
		fixture.editor.destroy();
	}
});

describe("AX1 React editor root", () => {
	it("AX1 marks the content root as a multiline textbox", async () => {
		const fixture = await renderRoot();
		const surface = fixture.container.querySelector(
			"[data-pen-editor-root]",
		);

		expect(surface).not.toBeNull();
		expect(surface?.getAttribute("role")).toBe("textbox");
		expect(surface?.getAttribute("aria-multiline")).toBe("true");
	});

	it("AX1 uses pen.a11yLabel and falls back to the catalog when missing", async () => {
		const fixture = await renderRoot();
		const surface = fixture.container.querySelector(
			"[data-pen-editor-root]",
		);

		expect(surface?.getAttribute("aria-label")).toBe("Editor");
	});

	it("AX1 applies createEditor a11yLabel to the content root", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
			a11yLabel: "Compose email",
		});
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		fixtures.push({ container, editor, root });

		await act(async () => {
			root.render(createElement(EditorRoot, { editor }));
		});

		const surface = container.querySelector("[data-pen-editor-root]");
		expect(surface?.getAttribute("aria-label")).toBe("Compose email");
		expect(surface?.hasAttribute("aria-labelledby")).toBe(false);
	});

	it("AX1 reflects the existing readonly prop as aria-readonly", async () => {
		const writable = await renderRoot();
		const readonly = await renderRoot(true);
		const writableSurface = writable.container.querySelector(
			"[data-pen-editor-root]",
		);
		const readonlySurface = readonly.container.querySelector(
			"[data-pen-editor-root]",
		);

		expect(writableSurface?.hasAttribute("aria-readonly")).toBe(false);
		expect(readonlySurface?.getAttribute("aria-readonly")).toBe("true");
	});
});
