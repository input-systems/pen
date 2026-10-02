import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { createAutocompleteStructuredCandidate } from "../structuredCandidate";
import { defaultSchema } from "@input/pen-schema";

describe("createAutocompleteStructuredCandidate", () => {
	it("uses single newlines for adjacent paragraph blocks", () => {
		const editor = createEditor({ schema: defaultSchema });

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			"Hey Oleksandr,\nHappy to set that up.\n- Krijn",
			{
				activeBlockType: "paragraph",
			},
		);

		expect(candidate.inlineText).toBe("Hey Oleksandr,");
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual(["Happy to set that up.", "- Krijn"]);

		editor.destroy();
	});

	it("treats blank lines between paragraphs as separators, not empty blocks", () => {
		const editor = createEditor({ schema: defaultSchema });

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			"Hey Oleksandr,\n\nHappy to set that up.\n\n- Krijn",
			{
				activeBlockType: "paragraph",
			},
		);

		expect(candidate.inlineText).toBe("Hey Oleksandr,");
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual(["Happy to set that up.", "- Krijn"]);

		editor.destroy();
	});

	it("keeps blank lines as empty blocks when the host asks for empty-block paragraph gaps", () => {
		const editor = createEditor({ schema: defaultSchema });

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			"Hey Oleksandr,\n\nHappy to set that up.\n\nBest,\nKrijn",
			{
				activeBlockType: "paragraph",
				paragraphGap: "empty-block",
			},
		);

		expect(candidate.inlineText).toBe("Hey Oleksandr,");
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual(["", "Happy to set that up.", "", "Best,", "Krijn"]);

		editor.destroy();
	});

	it("puts an empty block at every implicit paragraph split with empty-block gaps", () => {
		const editor = createEditor({ schema: defaultSchema });
		const first =
			"Thanks for sending the answers over, I will go through them tonight.";
		const second =
			"If anything is unclear I will get back to you before the end of the week.";

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			`${first} ${second}`,
			{
				activeBlockType: "paragraph",
				continuationDepth: 1,
				paragraphGap: "empty-block",
			},
		);

		expect(candidate.inlineText).toBe(first);
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual(["", second]);

		editor.destroy();
	});

	it("uses trailing single newlines to leave the caret in a new empty block", () => {
		const editor = createEditor({ schema: defaultSchema });

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			"Hey Oleksandr,\n",
			{
				activeBlockType: "paragraph",
			},
		);

		expect(candidate.inlineText).toBe("Hey Oleksandr,");
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual([""]);

		editor.destroy();
	});

	it("uses trailing double newlines to preserve a spacer before the next insertion target", () => {
		const editor = createEditor({ schema: defaultSchema });

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			"Hey Oleksandr,\n\n",
			{
				activeBlockType: "paragraph",
			},
		);

		expect(candidate.inlineText).toBe("Hey Oleksandr,");
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual(["", ""]);

		editor.destroy();
	});

	it("uses leading single newlines to start appended blocks", () => {
		const editor = createEditor({ schema: defaultSchema });

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			"\nSure thing – I can share that repo.\n- Krijn",
			{
				activeBlockType: "paragraph",
			},
		);

		expect(candidate.inlineText).toBe("");
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual(["Sure thing – I can share that repo.", "- Krijn"]);

		editor.destroy();
	});

	it("uses leading double newlines to insert a spacer before appended blocks", () => {
		const editor = createEditor({ schema: defaultSchema });

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			"\n\nSure thing – I can share that repo.\n\n- Krijn",
			{
				activeBlockType: "paragraph",
			},
		);

		expect(candidate.inlineText).toBe("");
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual(["", "Sure thing – I can share that repo.", "- Krijn"]);

		editor.destroy();
	});

	it("keeps markdown list continuations structured", () => {
		const editor = createEditor({ schema: defaultSchema });

		const candidate = createAutocompleteStructuredCandidate(
			editor,
			"\n- item one\n- item two",
			{
				activeBlockType: "paragraph",
			},
		);

		expect(candidate.inlineText).toBe("");
		expect(candidate.appendedBlocks.map((block) => block.type)).toEqual([
			"bulletListItem",
			"bulletListItem",
		]);
		expect(
			candidate.appendedBlocks.map((block) => block.content ?? ""),
		).toEqual(["item one", "item two"]);

		editor.destroy();
	});
});
