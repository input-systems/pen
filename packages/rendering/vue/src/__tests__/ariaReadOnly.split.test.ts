// @vitest-environment jsdom

import {
	defineExtension,
	ariaReadOnlyFacet,
	fieldEditorHostFacet,
} from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom";
import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
	document.body.replaceChildren();
});

function createSplitEditor(ariaReadOnlyFacetValue?: boolean) {
	return createTestEditor({
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
		blocks: [
			{
				id: "paragraph-1",
				type: "paragraph",
				props: {},
				content: "Locked",
			},
		],
	});
}

function fieldEditor(
	editor: ReturnType<typeof createTestEditor>,
): FieldEditorImpl | null {
	return (
		(editor.facet(fieldEditorHostFacet) as FieldEditorImpl | null) ?? null
	);
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

describe("Vue pen.ariaReadOnly vs readonly prop", () => {
	it.each(ARIA_READONLY_CASES)(
		"$name",
		async ({ facet, readonly, dataReadonly, editing }) => {
			const editor = createSplitEditor(facet);
			const wrapper = mount(PenEditor, {
				attachTo: document.body,
				props: {
					editor,
					...(readonly === undefined ? {} : { readonly }),
				},
			});

			const root = wrapper.get("[data-pen-editor-root]");
			expect(editor.facet(ariaReadOnlyFacet)).toBe(facet === true);
			expect(root.attributes("aria-readonly")).toBe("true");
			expect(root.attributes("data-readonly")).toBe(
				dataReadonly ? "" : undefined,
			);

			await wrapper.get("[data-pen-inline-content]").trigger("mousedown");
			await wrapper.get("[data-pen-inline-content]").trigger("click");
			await nextTick();

			expect(fieldEditor(editor)?.isEditing).toBe(editing);
			expect(
				wrapper.find("[data-pen-field-editor-active-surface]").exists(),
			).toBe(editing);

			wrapper.unmount();
			editor.destroy();
		},
	);
});
