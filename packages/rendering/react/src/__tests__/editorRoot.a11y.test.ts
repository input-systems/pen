// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createEditor as createCoreEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import { EditorRoot } from "../primitives/editor/root";
import { cleanupEditor, createEditor } from "./utils/editorRootTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderRoot(
	editor: ReturnType<typeof createEditor>,
	readonly?: boolean,
): Promise<{ container: HTMLDivElement; root: Root; host: HTMLElement }> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const reactRoot = createRoot(container);

	await act(async () => {
		reactRoot.render(React.createElement(EditorRoot, { editor, readonly }));
	});

	const host = container.querySelector("[data-pen-editor-root]");
	if (!(host instanceof HTMLElement)) {
		throw new Error("Missing editor root host");
	}
	return { container, root: reactRoot, host };
}

describe("@input/pen-react editor root a11y", () => {
	it.each([false, true])(
		"AX1 HOST6: editor root host is a labeled multiline textbox (readonly=%s) with valueless boolean data attributes",
		async (readonly) => {
			const editor = createEditor();
			const { container, root, host } = await renderRoot(
				editor,
				readonly,
			);

			expect(host.getAttribute("role")).toBe("textbox");
			expect(host.getAttribute("aria-multiline")).toBe("true");
			expect(host.getAttribute("aria-label")).toBe("Editor");
			expect(host.tabIndex).toBe(0);
			// AX1: aria-readonly reflects the readonly prop.
			expect(host.getAttribute("aria-readonly")).toBe(
				readonly ? "true" : null,
			);
			// HOST6: true is valueless, false is absent; never "true"/"false".
			expect(host.getAttribute("data-readonly")).toBe(
				readonly ? "" : null,
			);
			expect(host.matches("[data-readonly]")).toBe(readonly);
			expect(host.matches('[data-readonly="true"]')).toBe(false);
			expect(host.matches('[data-readonly="false"]')).toBe(false);
			expect(host.hasAttribute("data-empty")).toBe(false);

			await cleanupEditor(editor, root, container);
		},
	);

	it("AX1: createEditor a11yLabel labels the content root", async () => {
		const editor = createCoreEditor({
			schema: defaultSchema,
			preset: defaultPreset({
				tools: false,
				deltaStream: false,
				undo: false,
			}),
			a11yLabel: "Compose email",
		});
		const { container, root, host } = await renderRoot(editor);

		expect(host.getAttribute("aria-label")).toBe("Compose email");
		expect(host.hasAttribute("aria-labelledby")).toBe(false);

		await cleanupEditor(editor, root, container);
	});
});
