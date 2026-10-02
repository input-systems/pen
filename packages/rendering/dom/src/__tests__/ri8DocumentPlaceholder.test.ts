import { describe, expect, it } from "vitest";
import {
	createHeadlessEditor,
	defineBlock,
	mergeSchemas,
	SchemaRegistryImpl,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { getDocumentPlaceholderTargetBlockId } from "../utils/editorEmptyState";

/**
 * An email signature: chrome the host puts in the document, which the user
 * did not write and is not asked to write.
 */
const signature = defineBlock("signature", {
	content: "none",
	fieldEditor: "none",
	authoring: {
		contentRole: "chrome",
		flowCapability: "flow-structural",
		selectionRole: "structural",
	},
});

const schema = mergeSchemas(
	defaultSchema,
	new SchemaRegistryImpl({ blocks: [signature], inlines: [] }),
);

function createComposerEditor(): Editor {
	return createHeadlessEditor({ schema });
}

function insertSignature(editor: Editor, position: "first" | "last"): void {
	editor.apply(
		[
			{
				type: "insert-block",
				blockId: "signature-1",
				blockType: "signature",
				props: {},
				position,
			},
		],
		{ origin: "user" },
	);
}

function appendSignature(editor: Editor): void {
	insertSignature(editor, "last");
}

describe("RI8: document placeholder eligibility", () => {
	it("targets the body block when the only other root block is chrome", () => {
		const editor = createComposerEditor();
		const bodyId = editor.firstBlock()!.id;
		appendSignature(editor);

		expect(getDocumentPlaceholderTargetBlockId(editor)).toBe(bodyId);

		editor.destroy();
	});

	// Eligibility names the block it is about, so a document that opens with
	// chrome targets the body rather than the first root block. The paint site
	// and the click-below caret both read this id.
	it("targets the body block when the document opens with chrome", () => {
		const editor = createComposerEditor();
		const bodyId = editor.firstBlock()!.id;
		insertSignature(editor, "first");

		expect(editor.documentState.blockOrder[0]).toBe("signature-1");
		expect(getDocumentPlaceholderTargetBlockId(editor)).toBe(bodyId);

		editor.destroy();
	});

	it("has no target when every root block is chrome", () => {
		const editor = createComposerEditor();
		const bodyId = editor.firstBlock()!.id;
		appendSignature(editor);

		editor.apply([{ type: "delete-block", blockId: bodyId }], {
			origin: "user",
		});

		expect(getDocumentPlaceholderTargetBlockId(editor)).toBeNull();

		editor.destroy();
	});

	it("drops eligibility once the body beside the chrome has text", () => {
		const editor = createComposerEditor();
		appendSignature(editor);
		const bodyId = editor.firstBlock()!.id;

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: bodyId,
					from: 0,
					to: 0,
					insert: "hi",
				},
			],
			{ origin: "user" },
		);

		expect(getDocumentPlaceholderTargetBlockId(editor)).toBeNull();

		editor.destroy();
	});

	it("drops eligibility for a second content block, chrome or not", () => {
		const editor = createComposerEditor();
		appendSignature(editor);

		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "divider-1",
					blockType: "divider",
					props: {},
					position: "last",
				},
			],
			{ origin: "user" },
		);

		expect(getDocumentPlaceholderTargetBlockId(editor)).toBeNull();

		editor.destroy();
	});
});
