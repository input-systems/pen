// @vitest-environment jsdom

import { getVerticalCaretMeasure } from "@input/pen-core";
import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
	document.body.replaceChildren();
});

function createParagraphEditor() {
	return createTestEditor({
		blocks: [
			{
				id: "paragraph-1",
				type: "paragraph",
				props: {},
				content: "First paragraph",
			},
			{
				id: "paragraph-2",
				type: "paragraph",
				props: {},
				content: "Second paragraph",
			},
		],
	});
}

/**
 * G5: `pen.caretUp` / `pen.caretDown` are a mid-block no-op unless the host
 * injects a geometry measure. jsdom has no layout, so this asserts the wiring
 * contract only — that mounting registers the measure and unmounting clears it.
 * Whether the caret lands in the right place is Playwright's job
 * (`conformance/suites/geometry/g5-arrow-keystroke.spec.ts`).
 */
describe("PenEditor vertical caret measure", () => {
	it("registers a vertical caret measure while mounted and clears it on unmount", () => {
		const editor = createParagraphEditor();
		const wrapper = mount(PenEditor, {
			props: { editor },
			attachTo: document.body,
		});
		expect(getVerticalCaretMeasure(editor)).toEqual(expect.any(Function));

		wrapper.unmount();

		expect(getVerticalCaretMeasure(editor)).toBeUndefined();
		editor.destroy();
	});
});
