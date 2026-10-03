import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import {
	CLIPBOARD_INGEST_MAX_IMAGE_COUNT,
	CLIPBOARD_INGEST_MAX_NESTING_DEPTH,
	CLIPBOARD_INGEST_MAX_NODE_COUNT,
	CLIPBOARD_INGEST_MAX_TEXT_SIZE,
	admitClipboardBlocks,
	admitClipboardPlainText,
} from "../utils/clipboardIngest";
import type { PenBlock } from "../utils/clipboardPayload";
import { defaultSchema } from "@input/pen-schema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createBareEditor(): Editor {
	return createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
}

function nestToggles(depth: number): PenBlock {
	if (depth <= 1) {
		return { type: "paragraph", content: "leaf" };
	}
	return {
		type: "toggle",
		content: `d${depth}`,
		children: [nestToggles(depth - 1)],
	};
}

describe("IOP5 literal clipboard recovery bounds", () => {
	it.each(["\n", "\r\n"])(
		"bounds raw text before splitting and prefers a complete line (%j)",
		(newline) => {
			const editor = createBareEditor();
			const result = admitClipboardPlainText(
				"kept" + newline + "x".repeat(CLIPBOARD_INGEST_MAX_TEXT_SIZE),
				"paragraph",
				editor,
			);
			expect(result.blocks.map((block) => block.content)).toEqual([
				"kept",
			]);
			expect(result.droppedByReason).toEqual([
				{
					reason: "text-size-exceeded",
					count: 1,
					bound: "CLIPBOARD_INGEST_MAX_TEXT_SIZE",
				},
			]);
			editor.destroy();
		},
	);

	it("keeps a bounded prefix of an oversized single line", () => {
		const editor = createBareEditor();
		const result = admitClipboardPlainText(
			"x".repeat(CLIPBOARD_INGEST_MAX_TEXT_SIZE + 1),
			"paragraph",
			editor,
		);
		expect(result.blocks[0].content?.length).toBe(
			CLIPBOARD_INGEST_MAX_TEXT_SIZE,
		);
		expect(result.droppedByReason[0].reason).toBe("text-size-exceeded");
		editor.destroy();
	});

	it("bounds the number of recovered lines", () => {
		const editor = createBareEditor();
		const result = admitClipboardPlainText(
			Array(CLIPBOARD_INGEST_MAX_NODE_COUNT + 5)
				.fill("line")
				.join("\n"),
			"paragraph",
			editor,
		);
		expect(result.blocks).toHaveLength(CLIPBOARD_INGEST_MAX_NODE_COUNT);
		expect(result.droppedByReason).toEqual([
			{
				reason: "count-exceeded",
				count: 5,
				bound: "CLIPBOARD_INGEST_MAX_NODE_COUNT",
			},
		]);
		editor.destroy();
	});
});

describe("SEC4 clipboard JSON ingest bounds", () => {
	it("SEC4: drops blocks past depth 32", () => {
		const editor = createBareEditor();
		const result = admitClipboardBlocks(
			[nestToggles(CLIPBOARD_INGEST_MAX_NESTING_DEPTH + 1)],
			editor,
		);

		expect(result.droppedByReason).toEqual([
			{
				reason: "depth-exceeded",
				count: 1,
				bound: "CLIPBOARD_INGEST_MAX_NESTING_DEPTH",
			},
		]);

		let depth = 0;
		let current: PenBlock | undefined = result.blocks[0];
		while (current) {
			depth += 1;
			current = current.children?.[0];
		}
		expect(depth).toBe(CLIPBOARD_INGEST_MAX_NESTING_DEPTH);

		editor.destroy();
	});

	it("SEC4: drops blocks past the 10k node cap", () => {
		const editor = createBareEditor();
		const blocks: PenBlock[] = Array.from(
			{ length: CLIPBOARD_INGEST_MAX_NODE_COUNT + 5 },
			() => ({ type: "paragraph", content: "n" }),
		);

		const result = admitClipboardBlocks(blocks, editor);

		expect(result.blocks).toHaveLength(CLIPBOARD_INGEST_MAX_NODE_COUNT);
		expect(result.droppedByReason).toEqual([
			{
				reason: "count-exceeded",
				count: 5,
				bound: "CLIPBOARD_INGEST_MAX_NODE_COUNT",
			},
		]);

		editor.destroy();
	});

	it("IOP5: drops blocks past the 1 MiB text cap", () => {
		const editor = createBareEditor();
		const result = admitClipboardBlocks(
			[
				{
					type: "paragraph",
					content: "x".repeat(CLIPBOARD_INGEST_MAX_TEXT_SIZE),
				},
				{ type: "paragraph", content: "overflow" },
			],
			editor,
		);

		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0]?.content).toHaveLength(
			CLIPBOARD_INGEST_MAX_TEXT_SIZE,
		);
		expect(result.droppedByReason).toEqual([
			{
				reason: "text-size-exceeded",
				count: 1,
				bound: "CLIPBOARD_INGEST_MAX_TEXT_SIZE",
			},
		]);

		editor.destroy();
	});

	it("IOP5: drops image blocks past the 256 image cap", () => {
		const editor = createBareEditor();
		const blocks: PenBlock[] = Array.from(
			{ length: CLIPBOARD_INGEST_MAX_IMAGE_COUNT + 2 },
			(_, index) => ({
				type: "image",
				props: { src: `https://example.com/${index}.png` },
			}),
		);

		const result = admitClipboardBlocks(blocks, editor);

		expect(result.blocks).toHaveLength(CLIPBOARD_INGEST_MAX_IMAGE_COUNT);
		expect(result.droppedByReason).toEqual([
			{
				reason: "image-count-exceeded",
				count: 2,
				bound: "CLIPBOARD_INGEST_MAX_IMAGE_COUNT",
			},
		]);

		editor.destroy();
	});
});
