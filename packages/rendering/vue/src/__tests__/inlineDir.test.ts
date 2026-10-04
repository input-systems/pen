// @vitest-environment jsdom

import { createTestEditor } from "@input/pen-test";
import type { Editor } from "@input/pen-types";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { PenEditor } from "../components/PenEditor";
import { PenInlineContent } from "../components/PenInlineContent";
import { provideEditorContext } from "../internal/editorContext";
import { provideFieldEditorContext } from "../internal/fieldEditorContext";

afterEach(() => {
	document.body.replaceChildren();
});

function mountInlineContent(args: {
	editor: Editor;
	blockId: string;
	direction?: string;
}) {
	const Harness = defineComponent({
		setup() {
			provideEditorContext({
				editor: args.editor,
				readonly: ref(false),
				emptyPlaceholder: ref(undefined),
				renderers: ref(undefined),
				rootElement: ref(null),
			});
			provideFieldEditorContext(null);
			return () =>
				h(PenInlineContent, {
					blockId: args.blockId,
					...(args.direction !== undefined
						? { direction: args.direction }
						: {}),
				});
		},
	});

	return mount(Harness, { attachTo: document.body });
}

describe("PenInlineContent DIR2", () => {
	it.each([
		{ direction: "ltr", content: "Hello", expected: "ltr" },
		{ direction: "rtl", content: "مرحبا", expected: "rtl" },
		{ direction: undefined, content: "Plain", expected: undefined },
		{ direction: "auto", content: "Auto", expected: undefined },
	])(
		"DIR2: direction prop $direction renders dir=$expected on the inline host",
		({ direction, content, expected }) => {
			const editor = createTestEditor({
				blocks: [
					{ id: "paragraph", type: "paragraph", props: {}, content },
				],
			});
			const wrapper = mountInlineContent({
				editor,
				blockId: "paragraph",
				...(direction !== undefined ? { direction } : {}),
			});

			expect(
				wrapper.get("[data-pen-inline-content]").attributes("dir"),
			).toBe(expected);
			expect(wrapper.html()).not.toContain('dir="auto"');

			wrapper.unmount();
			editor.destroy();
		},
	);

	it("DIR2: sets dir on the inline content host from block props.direction", () => {
		const editor = createTestEditor({
			blocks: [
				{
					id: "paragraph-ltr",
					type: "paragraph",
					props: { direction: "ltr" },
					content: "Hello",
				},
				{
					id: "paragraph-rtl",
					type: "paragraph",
					props: { direction: "rtl" },
					content: "مرحبا",
				},
			],
		});

		const wrapper = mount(PenEditor, {
			attachTo: document.body,
			props: { editor },
		});

		expect(
			wrapper
				.get(
					'[data-block-id="paragraph-ltr"] [data-pen-inline-content]',
				)
				.attributes("dir"),
		).toBe("ltr");
		expect(
			wrapper
				.get(
					'[data-block-id="paragraph-rtl"] [data-pen-inline-content]',
				)
				.attributes("dir"),
		).toBe("rtl");

		wrapper.unmount();
		editor.destroy();
	});
});
