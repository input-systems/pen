// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	createEditor,
	defineExtension,
	ariaReadOnlyFacet,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { type Editor } from "@input/pen-types";
import { mountEditor } from "../host/mountEditor";
import { DATA_ATTRS } from "../utils/dataAttributes";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createBareEditor(ariaReadOnlyFacetValue?: boolean): Editor {
	return createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
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

describe("mountEditor pen.ariaReadOnly vs readonly prop", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		for (const cleanup of cleanups.splice(0)) {
			cleanup();
		}
		document.body.replaceChildren();
	});

	function mount(
		editor: Editor,
		readonly?: boolean,
	): ReturnType<typeof mountEditor> {
		const root = document.createElement("div");
		document.body.append(root);
		const mounted = mountEditor(
			editor,
			root,
			readonly === undefined ? {} : { readonly },
		);
		cleanups.push(() => {
			mounted.destroy();
			editor.destroy();
		});
		return mounted;
	}

	function activateInline(root: HTMLElement): void {
		const inline = root.querySelector(`[${DATA_ATTRS.inlineContent}]`);
		expect(inline).toBeInstanceOf(HTMLElement);
		inline?.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
	}

	it.each(ARIA_READONLY_CASES)(
		"$name",
		({ facet, readonly, dataReadonly, editing }) => {
			const editor = createBareEditor(facet);
			const mounted = mount(editor, readonly);
			expect(editor.facet(ariaReadOnlyFacet)).toBe(facet === true);
			expect(mounted.root.getAttribute("aria-readonly")).toBe("true");
			expect(mounted.root.hasAttribute(DATA_ATTRS.readonly)).toBe(
				dataReadonly,
			);

			activateInline(mounted.root);
			expect(mounted.fieldEditor.isEditing).toBe(editing);
		},
	);
});
