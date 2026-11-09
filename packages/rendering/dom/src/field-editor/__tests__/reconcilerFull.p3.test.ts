// @vitest-environment jsdom

import { createHeadlessEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyInlineDecorationsToDeltas } from "../../utils/inlineDecorations";
import { fullReconcileDeltasToDOM } from "../reconcilerFull";

const SELECTION_WRITES = [
	"addRange",
	"removeAllRanges",
	"setBaseAndExtent",
	"collapse",
	"extend",
] as const;

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe("full reconcile and the native selection (P3)", () => {
	it("P3: a field reconcile never saves or restores the native range; the caller projects", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const element = document.createElement("span");
		element.textContent = "hello";
		document.body.append(element);
		const selection = document.getSelection()!;
		selection.collapse(element.firstChild, 2);
		const spies = SELECTION_WRITES.map((method) =>
			vi.spyOn(Selection.prototype, method),
		);

		fullReconcileDeltasToDOM(
			[{ insert: "hello world" }],
			element,
			editor.schema,
			{
				editor,
			},
		);

		expect(element.textContent).toBe("hello world");
		for (const spy of spies) {
			expect(spy).not.toHaveBeenCalled();
		}
		editor.destroy();
	});

	it("P3: a decoration whose attributes change keeps its text node, so a native range inside it stands", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const element = document.createElement("span");
		document.body.append(element);
		const render = (className: string) =>
			fullReconcileDeltasToDOM(
				applyInlineDecorationsToDeltas(
					[{ insert: "say hello world" }],
					[
						{
							type: "inline",
							blockId: "block",
							from: 4,
							to: 15,
							attributes: { class: className },
						},
					],
				),
				element,
				editor.schema,
				{ editor },
			);
		render("pen-ai-suggestion-underline");
		const wrapper = element.querySelector(".pen-ai-suggestion-underline")!;
		const text = wrapper.firstChild!;
		document.getSelection()!.setBaseAndExtent(text, 0, text, 5);

		render("pen-ai-suggestion-underline pen-ai-suggestion-active");

		expect(wrapper.isConnected).toBe(true);
		expect(wrapper.className).toBe(
			"pen-ai-suggestion-underline pen-ai-suggestion-active",
		);
		expect(wrapper.firstChild).toBe(text);
		expect(String(document.getSelection())).toBe("hello");
		editor.destroy();
	});
});
