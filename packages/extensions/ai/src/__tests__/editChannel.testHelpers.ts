import { aiExtension } from "../index";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { deltaStreamExtension } from "../stream";
import type { ModelAdapter } from "@input/pen-types";
import { toolsExtension } from "@input/pen-tools";
import { undoExtension } from "@input/pen-undo";

export const BLOCK_ANNOTATION_PATTERN = /<!-- block:(\S+) (\S+) -->/g;

export interface Annotation {
	id: string;
	type: string;
}

export function annotationsFromRequest(request: {
	messages: unknown;
}): Annotation[] {
	const serialized = JSON.stringify(request.messages);
	return [...serialized.matchAll(BLOCK_ANNOTATION_PATTERN)].map((match) => ({
		id: match[1]!,
		type: match[2]!,
	}));
}

export function createChatEditor(model: ModelAdapter) {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({
				model,
				contentFormat: { blockGeneration: "markdown" },
				mutationPreference: "direct",
				allowedMutatingTools: ["edit_document"],
			}),
		],
	});
}

export const PROMPT = "Turn the last paragraph into a bullet list";

export const ORIGINAL = "Revenue grew. Costs fell. Margins improved.";

export function seedDocument(editor: ReturnType<typeof createEditor>): string {
	const headingId = editor.firstBlock()!.id;
	editor.apply(
		[
			{
				type: "set-props",
				blockId: headingId,
				props: { type: "heading", level: 1 },
			},
			{
				type: "splice-text",
				blockId: headingId,
				from: 0,
				to: 0,
				insert: "Quarterly Report",
			},
			{
				type: "insert-block",
				blockId: "closing",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "closing",
				from: 0,
				to: 0,
				insert: ORIGINAL,
			},
		],
		{ origin: "system" },
	);
	return "closing";
}

export function snapshot(editor: ReturnType<typeof createEditor>) {
	return Array.from(editor.blocks()).map((block) => ({
		id: block.id,
		type: block.type,
		text: block.textContent(),
	}));
}
