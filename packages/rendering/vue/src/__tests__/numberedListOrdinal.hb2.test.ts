// @vitest-environment jsdom

import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
	document.body.replaceChildren();
});

describe("@input/pen-vue numbered list ordinals", () => {
	it("HB2: a Vue numbered item's marker updates when an item is inserted above it", async () => {
		const editor = createTestEditor({
			blocks: [
				{ id: "n1", type: "numberedListItem", props: {}, content: "one" },
				{ id: "n2", type: "numberedListItem", props: {}, content: "two" },
				{ id: "n3", type: "numberedListItem", props: {}, content: "three" },
			],
		});
		const wrapper = mount(PenEditor, { attachTo: document.body, props: { editor } });
		const marker = (blockId: string) =>
			wrapper.find(`[data-block-id="${blockId}"] [data-pen-list-marker]`).text();
		expect(marker("n3")).toBe("3.");

		editor.apply(
			[{ type: "insert-block", blockId: "n0", blockType: "numberedListItem", props: {}, position: "first" }],
			{ origin: "collaborator" },
		);
		await nextTick();

		expect(marker("n0")).toBe("1.");
		expect(marker("n3")).toBe("4.");
		wrapper.unmount();
		editor.destroy();
	});
});
