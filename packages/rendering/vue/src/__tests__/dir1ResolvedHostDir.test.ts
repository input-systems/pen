// @vitest-environment jsdom

import {
	blockDirectionFacet,
	defaultDirectionFacet,
	defineExtension,
	resolveBlockDirection,
} from "@input/pen-core";
import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
	document.body.replaceChildren();
});

function mountEditor(editor: ReturnType<typeof createTestEditor>) {
	return mount(PenEditor, {
		attachTo: document.body,
		props: { editor },
	});
}

function hostDir(
	wrapper: ReturnType<typeof mountEditor>,
	blockId: string,
): string | undefined {
	return wrapper.get(`[data-block-id="${blockId}"]`).attributes("dir");
}

const DIR1_CASES: Array<{
	name: string;
	extensions: NonNullable<
		Parameters<typeof createTestEditor>[0]
	>["extensions"];
	text: string;
	direction?: "ltr" | "rtl";
	expected: "ltr" | "rtl";
}> = [
	{
		name: "LTR text with no facet and no prop omits dir",
		extensions: [],
		text: "Hello",
		expected: "ltr",
	},
	{
		name: "pen.blockDirection resolver changes rendered dir",
		extensions: [
			defineExtension({
				name: "dir-facet",
				facets: [blockDirectionFacet.of(() => "rtl")],
			}),
		],
		text: "Hello",
		expected: "rtl",
	},
	{
		name: "explicit props.direction wins over pen.blockDirection",
		extensions: [
			defineExtension({
				name: "dir-facet",
				facets: [blockDirectionFacet.of(() => "rtl")],
			}),
		],
		text: "Hello",
		direction: "ltr",
		expected: "ltr",
	},
	{
		name: "first-strong RTL text with no prop and no resolver renders RTL",
		extensions: [],
		text: "مرحبا",
		expected: "rtl",
	},
	{
		name: "pen.defaultDirection applies when nothing else does",
		extensions: [
			defineExtension({
				name: "dir-default",
				facets: [defaultDirectionFacet.of("rtl")],
			}),
		],
		text: "12345",
		expected: "rtl",
	},
];

describe("Vue DIR1 resolved host dir", () => {
	it.each(DIR1_CASES)(
		"DIR1: $name",
		({ extensions, text, direction, expected }) => {
			const editor = createTestEditor({
				blocks: [
					{
						id: "paragraph",
						type: "paragraph",
						props: direction ? { direction } : {},
						content: text,
					},
				],
				extensions,
			});
			const wrapper = mountEditor(editor);
			const block = editor.getBlock("paragraph");

			expect(resolveBlockDirection(editor, block)).toBe(expected);
			expect(hostDir(wrapper, "paragraph")).toBe(
				expected === "ltr" && !direction ? undefined : expected,
			);
			expect(wrapper.html()).not.toContain('dir="auto"');

			wrapper.unmount();
			editor.destroy();
		},
	);

	it("RI1: block and inline content hosts are unicode-bidi isolate", () => {
		const editor = createTestEditor({
			blocks: [
				{
					id: "paragraph-arabic",
					type: "paragraph",
					props: {},
					content: "مرحبا",
				},
			],
		});
		const wrapper = mountEditor(editor);
		const host = wrapper.get('[data-block-id="paragraph-arabic"]');
		const inline = wrapper.get(
			'[data-block-id="paragraph-arabic"] [data-pen-inline-content]',
		);

		expect((host.element as HTMLElement).style.unicodeBidi).toBe("isolate");
		expect((inline.element as HTMLElement).style.unicodeBidi).toBe(
			"isolate",
		);
		// Resolved RTL lands on the block host only, not the inline host.
		expect(host.attributes("dir")).toBe("rtl");
		expect(inline.attributes("dir")).toBeUndefined();

		wrapper.unmount();
		editor.destroy();
	});

	it("DIR1: host dir tracks cache invalidation when block text changes", async () => {
		const editor = createTestEditor({
			blocks: [
				{
					id: "paragraph-flip",
					type: "paragraph",
					props: {},
					content: "مرحبا",
				},
			],
		});
		const wrapper = mountEditor(editor);
		expect(hostDir(wrapper, "paragraph-flip")).toBe("rtl");

		editor.apply([
			{
				type: "splice-text",
				blockId: "paragraph-flip",
				from: 0,
				to: 0 + editor.getBlock("paragraph-flip").length(),
				insert: "Hello",
			},
		]);
		await nextTick();

		expect(
			resolveBlockDirection(editor, editor.getBlock("paragraph-flip")),
		).toBe("ltr");
		expect(hostDir(wrapper, "paragraph-flip")).toBeUndefined();

		wrapper.unmount();
		editor.destroy();
	});
});
