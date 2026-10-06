import { describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";

import { createEditor as createCoreEditor } from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";
import {
	inlineLogicalText,
	resolveSuggestionMenuTarget,
} from "../suggestion/resolveSuggestionMenuTarget";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createEditor() {
	return createCoreEditor({
		schema: createDefaultSchema(),
		preset: noDefaultExtensionsPreset,
	});
}

const AT_TRIGGER = { char: "@" } as const;
const AT_WHITESPACE_TRIGGER = {
	char: "@",
	boundary: "whitespace" as const,
};

function insertMentionThen(editor: Editor, blockId: string, after: string) {
	editor.apply(
		[
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: [
					{
						nodeType: "mention",
						props: { id: "1", label: "Ada" },
					},
					after,
				],
			},
		],
		{ origin: "user" },
	);
}

describe("N6 resolveSuggestionMenuTarget logical offsets", () => {
	it("N6: matches a trigger in ordinary stored text", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hi @al",
			},
		]);
		editor.selectText(blockId, 6, 6);

		expect(resolveSuggestionMenuTarget(editor, AT_TRIGGER)).toEqual({
			blockId,
			startOffset: 3,
			endOffset: 6,
			query: "al",
			trigger: "@",
		});
		editor.destroy();
	});

	it("N6: atom-before-trigger keeps startOffset after the atom", () => {
		const editor = createEditor();
		const block = editor.firstBlock()!;
		insertMentionThen(editor, block.id, "@");
		editor.selectText(block.id, 2, 2);

		expect(block.length()).toBe(2);
		expect(block.textContent()).toBe("@");
		expect(inlineLogicalText(block)).toBe("\uFFFC@");
		expect(resolveSuggestionMenuTarget(editor, AT_TRIGGER)).toEqual({
			blockId: block.id,
			startOffset: 1,
			endOffset: 2,
			query: "",
			trigger: "@",
		});
		expect(
			resolveSuggestionMenuTarget(editor, AT_WHITESPACE_TRIGGER),
		).toBeNull();
		editor.destroy();
	});

	it("N6: a whitespace boundary anchors on the last trigger that satisfies it", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "hi @thijs@gm",
			},
		]);
		editor.selectText(blockId, 12, 12);

		expect(
			resolveSuggestionMenuTarget(editor, AT_WHITESPACE_TRIGGER),
		).toEqual({
			blockId,
			startOffset: 3,
			endOffset: 12,
			query: "thijs@gm",
			trigger: "@",
		});
		expect(resolveSuggestionMenuTarget(editor, AT_TRIGGER)).toMatchObject({
			startOffset: 9,
			query: "gm",
		});
		editor.destroy();
	});

	it("N6: a whitespace boundary rejects text with no trigger that satisfies it", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "hi thijs@gm",
			},
		]);
		editor.selectText(blockId, 11, 11);

		expect(
			resolveSuggestionMenuTarget(editor, AT_WHITESPACE_TRIGGER),
		).toBeNull();
		editor.destroy();
	});

	it("N6: rejects an atom inside the typed prefix", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: [
						"@",
						{
							nodeType: "mention",
							props: { id: "1", label: "Ada" },
						},
						"x",
					],
				},
			],
			{ origin: "user" },
		);
		editor.selectText(blockId, 3, 3);

		expect(resolveSuggestionMenuTarget(editor, AT_TRIGGER)).toBeNull();
		editor.destroy();
	});

	it("N6: a spaced trigger after an atom does not claim the atom offset", () => {
		const editor = createEditor();
		const block = editor.firstBlock()!;
		insertMentionThen(editor, block.id, " @");
		editor.selectText(block.id, 3, 3);

		expect(resolveSuggestionMenuTarget(editor, AT_TRIGGER)).toEqual({
			blockId: block.id,
			startOffset: 2,
			endOffset: 3,
			query: "",
			trigger: "@",
		});
		editor.destroy();
	});
});
