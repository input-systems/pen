// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { EditorRoot } from "../primitives/editor/root";
import {
	buildDataAttributes,
	DATA_ATTRS,
} from "@input/pen-dom/utils/dataAttributes";
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

describe("HOST6 boolean data-attribute form", () => {
	it("HOST6: true is valueless and false is omitted", () => {
		expect(
			buildDataAttributes({
				[DATA_ATTRS.readonly]: true,
				[DATA_ATTRS.empty]: false,
				[DATA_ATTRS.focused]: undefined,
			}),
		).toEqual({
			[DATA_ATTRS.readonly]: "",
		});
		expect(
			Object.keys(
				buildDataAttributes({
					[DATA_ATTRS.readonly]: false,
				}),
			),
		).toEqual([]);
	});

	it('HOST6: rendered root matches [data-readonly] and not [data-readonly="true"]', async () => {
		const editor = createEditor();
		const { container, root, host } = await renderRoot(editor, true);

		expect(host.getAttribute("data-readonly")).toBe("");
		expect(host.matches("[data-readonly]")).toBe(true);
		expect(host.matches('[data-readonly=""]')).toBe(true);
		expect(host.matches('[data-readonly="true"]')).toBe(false);
		expect(host.matches('[data-readonly="false"]')).toBe(false);
		expect(host.getAttribute("aria-readonly")).toBe("true");

		await cleanupEditor(editor, root, container);
	});

	it("HOST6: false boolean is absent so [data-readonly] does not match", async () => {
		const editor = createEditor();
		const { container, root, host } = await renderRoot(editor);

		expect(host.hasAttribute("data-readonly")).toBe(false);
		expect(host.matches("[data-readonly]")).toBe(false);
		expect(host.matches('[data-readonly="false"]')).toBe(false);
		expect(host.hasAttribute("aria-readonly")).toBe(false);

		await cleanupEditor(editor, root, container);
	});
});
