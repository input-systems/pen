// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import {
	createEditor,
	getFieldEditor,
} from "./utils/selectionDeletionTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

// O5: alt-tab leaves document.activeElement inside the root; the overlay
// caret must still stop painting while the window is inactive.
describe("Pen.Editor.Root focus follows the window (O5)", () => {
	it("an inactive window unfocuses the field, and coming back refocuses it", async () => {
		const editor = createEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const reactRoot = createRoot(container);
		await act(async () => {
			reactRoot.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});
		const fieldEditor = getFieldEditor(editor);
		const root = container.querySelector<HTMLElement>(
			"[data-pen-editor-root]",
		)!;
		const inner = document.createElement("button");
		root.append(inner);
		await act(async () => {
			inner.focus();
		});
		expect(fieldEditor.isFocused).toBe(true);

		const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
		await act(async () => {
			window.dispatchEvent(new FocusEvent("blur"));
		});
		expect(document.activeElement).toBe(inner);
		expect(fieldEditor.isFocused).toBe(false);
		expect(root.hasAttribute("data-focused")).toBe(false);

		hasFocus.mockReturnValue(true);
		await act(async () => {
			window.dispatchEvent(new FocusEvent("focus"));
		});
		expect(fieldEditor.isFocused).toBe(true);

		await act(async () => {
			reactRoot.unmount();
		});
		editor.destroy();
	});
});
