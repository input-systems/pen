// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
	createEditor,
	defineExtension,
	ariaReadOnlyFacet,
	fieldEditorHostFacet,
} from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import type { FieldEditorImpl } from "@input/pen-dom";
import type { Editor } from "@input/pen-types";
import { PenEditor } from "../penEditor";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createTestEditor(ariaReadOnlyFacetValue?: boolean) {
	return createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
		extensions:
			ariaReadOnlyFacetValue === undefined
				? []
				: [
						defineExtension({
							name: "aria-readonly-split",
							facets: [
								ariaReadOnlyFacet.of(ariaReadOnlyFacetValue),
							],
						}),
					],
	});
}

const fixtures: Array<{
	container: HTMLElement;
	editor: Editor;
	root: Root;
}> = [];

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

async function renderEditor(
	editor: Editor,
	readonly?: boolean,
): Promise<{ container: HTMLElement; host: HTMLElement }> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	fixtures.push({ container, editor, root });

	await act(async () => {
		root.render(
			React.createElement(PenEditor, {
				editor,
				...(readonly === undefined ? {} : { readonly }),
			}),
		);
	});

	const host = container.querySelector("[data-pen-editor-root]");
	if (!(host instanceof HTMLElement)) {
		throw new Error("Missing editor root host");
	}
	return { container, host };
}

function fieldEditor(editor: Editor): FieldEditorImpl | null {
	return (
		(editor.facet(fieldEditorHostFacet) as FieldEditorImpl | null) ?? null
	);
}

async function pointerActivateInline(container: HTMLElement): Promise<void> {
	const inline = container.querySelector("[data-pen-inline-content]");
	expect(inline).toBeInstanceOf(HTMLElement);
	await act(async () => {
		for (const type of ["mousedown", "mouseup", "click"]) {
			inline?.dispatchEvent(
				new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
			);
		}
	});
}

const ARIA_READONLY_CASES = [
	{
		name: "ariaReadOnly facet announces aria-readonly and still accepts typing",
		facet: true,
		readonly: undefined,
		dataReadonly: false,
		editing: true,
	},
	{
		name: "readonly prop announces aria-readonly and declines typing",
		facet: undefined,
		readonly: true,
		dataReadonly: true,
		editing: false,
	},
	{
		name: "ariaReadOnly facet plus readonly prop: prop wins for typing, both set aria-readonly",
		facet: true,
		readonly: true,
		dataReadonly: true,
		editing: false,
	},
] as const;

describe("React pen.ariaReadOnly vs readonly prop", () => {
	it.each(ARIA_READONLY_CASES)(
		"$name",
		async ({ facet, readonly, dataReadonly, editing }) => {
			const editor = createTestEditor(facet);
			const { container, host } = await renderEditor(editor, readonly);
			expect(editor.facet(ariaReadOnlyFacet)).toBe(facet === true);
			expect(host.getAttribute("aria-readonly")).toBe("true");
			expect(host.hasAttribute("data-readonly")).toBe(dataReadonly);

			await pointerActivateInline(container);
			expect(fieldEditor(editor)?.isEditing).toBe(editing);
		},
	);
});
