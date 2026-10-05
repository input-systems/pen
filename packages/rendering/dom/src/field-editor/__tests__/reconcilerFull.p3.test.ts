// @vitest-environment jsdom

import { createHeadlessEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
