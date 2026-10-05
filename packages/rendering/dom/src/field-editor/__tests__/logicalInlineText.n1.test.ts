import { describe, expect, it } from "vitest";
import { getLogicalInlineText } from "../commandsShared";
import { INLINE_ATOM_REPLACEMENT_TEXT } from "../inlineAtomModel";

describe("getLogicalInlineText (N1)", () => {
	it("N1: an inline embed reads as one U+FFFC, matching the DOM's logical text", () => {
		const ytext = {
			length: 9,
			toString: () => "Hi there",
			toDelta: () => [
				{ insert: "Hi " },
				{ insert: { type: "mention", props: { label: "Ada" } } },
				{ insert: "there" },
			],
		};

		expect(getLogicalInlineText(ytext)).toBe(
			`Hi ${INLINE_ATOM_REPLACEMENT_TEXT}there`,
		);
		expect(getLogicalInlineText(ytext)).toHaveLength(ytext.length);
	});

	it("N1: an atom-only field is not empty text", () => {
		const ytext = {
			length: 1,
			toString: () => "",
			toDelta: () => [{ insert: { type: "mention", props: {} } }],
		};

		expect(getLogicalInlineText(ytext)).toBe(INLINE_ATOM_REPLACEMENT_TEXT);
	});
});
