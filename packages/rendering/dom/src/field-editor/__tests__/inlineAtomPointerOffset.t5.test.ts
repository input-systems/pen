// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { getInlineAtomPointerOffset } from "../inlineAtomDom";

/**
 * T5 / O1: the half of an atom a click lands on decides the side it takes,
 * read in the direction of the bidi run the atom sits in, not the block's.
 * Layout is stubbed: the atom box spans x 100..140, so x 110 is its visual
 * left half and x 130 its right half.
 */

const ATOM_RECT = { left: 100, right: 140, top: 0, bottom: 20 };

function inlineWith(
	direction: "ltr" | "rtl",
	before: string,
	label: string,
	after: string,
): HTMLElement {
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.setAttribute("dir", direction);
	inline.style.direction = direction;
	inline.append(before);
	const host = document.createElement("span");
	host.setAttribute(DATA_ATTRS.inlineAtomHost, "");
	const chip = document.createElement("span");
	chip.setAttribute(DATA_ATTRS.inlineAtom, "");
	chip.textContent = label;
	chip.getBoundingClientRect = () =>
		({
			...ATOM_RECT,
			x: ATOM_RECT.left,
			y: ATOM_RECT.top,
			width: ATOM_RECT.right - ATOM_RECT.left,
			height: ATOM_RECT.bottom - ATOM_RECT.top,
			toJSON: () => ({}),
		}) as DOMRect;
	host.append(chip);
	inline.append(host, after);
	document.body.append(inline);
	return inline;
}

const LEFT_HALF_X = 110;
const RIGHT_HALF_X = 130;
const Y = 10;

describe("getInlineAtomPointerOffset (T5, O1)", () => {
	it("T5: an atom in a left-to-right block takes its start on the left half", () => {
		const inline = inlineWith("ltr", "Hello ", "@Ada", " world");
		expect(getInlineAtomPointerOffset(inline, LEFT_HALF_X, Y)).toBe(6);
		expect(getInlineAtomPointerOffset(inline, RIGHT_HALF_X, Y)).toBe(7);
		inline.remove();
	});

	it("T5: an atom in a right-to-left run takes its start on the right half", () => {
		const inline = inlineWith("rtl", "مرحبا ", "@Ada", " عالم");
		expect(getInlineAtomPointerOffset(inline, RIGHT_HALF_X, Y)).toBe(6);
		expect(getInlineAtomPointerOffset(inline, LEFT_HALF_X, Y)).toBe(7);
		inline.remove();
	});

	it("T5: an atom in a left-to-right run inside a right-to-left block takes its start on the left half", () => {
		const inline = inlineWith("rtl", "مرحبا abc ", "@Ada", " def عالم");
		expect(getInlineAtomPointerOffset(inline, LEFT_HALF_X, Y)).toBe(10);
		expect(getInlineAtomPointerOffset(inline, RIGHT_HALF_X, Y)).toBe(11);
		inline.remove();
	});

	it("T5: an atom in a right-to-left run inside a left-to-right block takes its start on the right half", () => {
		const inline = inlineWith("ltr", "hello שלום ", "@דנה", " עולם world");
		expect(getInlineAtomPointerOffset(inline, RIGHT_HALF_X, Y)).toBe(11);
		expect(getInlineAtomPointerOffset(inline, LEFT_HALF_X, Y)).toBe(12);
		inline.remove();
	});
});
