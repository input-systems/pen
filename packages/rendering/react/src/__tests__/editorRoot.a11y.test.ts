// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createEditor as createCoreEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { EditorRoot } from "../primitives/editor/root";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createEditor() {
	return createCoreEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

async function renderRoot(
	editor: ReturnType<typeof createEditor>,
	readonly?: boolean,
): Promise<{ container: HTMLDivElement; root: Root }> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const reactRoot = createRoot(container);

	await act(async () => {
		reactRoot.render(React.createElement(EditorRoot, { editor, readonly }));
	});

	return { container, root: reactRoot };
}

async function cleanupEditor(
	editor: ReturnType<typeof createEditor>,
	root: Root,
	container: HTMLElement,
): Promise<void> {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	editor.destroy();
}

function getEditorRoot(container: HTMLElement): HTMLElement {
	const host = container.querySelector("[data-pen-editor-root]");
	if (!(host instanceof HTMLElement)) {
		throw new Error("Missing editor root host");
	}
	return host;
}

describe("@input/pen-react editor root a11y", () => {
	it("AX1: editor root host is a labeled multiline textbox", async () => {
		const editor = createEditor();
		const { container, root } = await renderRoot(editor);
		const host = getEditorRoot(container);

		expect(host.getAttribute("role")).toBe("textbox");
		expect(host.getAttribute("aria-multiline")).toBe("true");
		expect(host.getAttribute("aria-label")).toBe("Editor");
		expect(host.tabIndex).toBe(0);
		expect(host.hasAttribute("aria-readonly")).toBe(false);
		expect(host.hasAttribute("data-readonly")).toBe(false);

		await cleanupEditor(editor, root, container);
	});

	it("HOST6: boolean data attributes are valueless", async () => {
		const editor = createEditor();
		const { container, root } = await renderRoot(editor, true);
		const host = getEditorRoot(container);

		expect(host.getAttribute("data-readonly")).toBe("");
		expect(host.hasAttribute("data-empty")).toBe(false);

		await cleanupEditor(editor, root, container);
	});

	it("AX1: aria-readonly reflects the existing readonly prop", async () => {
		const editor = createEditor();
		const { container, root } = await renderRoot(editor, true);
		const host = getEditorRoot(container);

		expect(host.getAttribute("role")).toBe("textbox");
		expect(host.getAttribute("aria-multiline")).toBe("true");
		expect(host.getAttribute("aria-label")).toBe("Editor");
		expect(host.getAttribute("aria-readonly")).toBe("true");
		expect(host.getAttribute("data-readonly")).toBe("");

		await cleanupEditor(editor, root, container);
	});
});
