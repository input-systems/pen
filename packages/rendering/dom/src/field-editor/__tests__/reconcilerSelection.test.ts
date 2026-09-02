// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { saveSelection } from "../reconcilerSelection";

function mountBlocks(): { first: HTMLElement; second: HTMLElement } {
	const first = document.createElement("div");
	first.textContent = "first block";
	const second = document.createElement("div");
	second.textContent = "second block";
	document.body.append(first, second);
	return { first, second };
}

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

describe("saveSelection", () => {
	it("captures a range that lies inside the element", () => {
		const { first } = mountBlocks();
		const text = first.firstChild!;
		window.getSelection()!.setBaseAndExtent(text, 2, text, 7);

		expect(saveSelection(first)).toEqual({
			anchorOffset: 2,
			focusOffset: 7,
		});
	});

	it("declines a range whose other endpoint lives in another block", () => {
		const { first, second } = mountBlocks();
		window
			.getSelection()!
			.setBaseAndExtent(first.firstChild!, 2, second.firstChild!, 3);

		expect(saveSelection(first)).toBeNull();
		expect(saveSelection(second)).toBeNull();
	});
});
