import { afterAll, describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
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

// Admission reads the schema only; one editor serves every case.
const editor = createEditor({ schema: defaultSchema, preset: { resolve: () => ({ extensions: [] }) } });

afterAll(() => {
	editor.destroy();
});

function nestToggles(depth: number): PenBlock {
	if (depth <= 1) {
		return { type: "paragraph", content: "leaf" };
	}
	return { type: "toggle", content: `d${depth}`, children: [nestToggles(depth - 1)] };
}

const TEXT_DROPPED = { reason: "text-size-exceeded", count: 1, bound: "CLIPBOARD_INGEST_MAX_TEXT_SIZE" };
const NODES_DROPPED = { reason: "count-exceeded", count: 5, bound: "CLIPBOARD_INGEST_MAX_NODE_COUNT" };

describe("IOP5 literal clipboard recovery bounds", () => {
	it.each(["\n", "\r\n"])("bounds raw text before splitting and prefers a complete line (%j)", (newline) => {
		const result = admitClipboardPlainText(
			"kept" + newline + "x".repeat(CLIPBOARD_INGEST_MAX_TEXT_SIZE),
			"paragraph",
			editor,
		);
		expect(result.blocks.map((block) => block.content)).toEqual(["kept"]);
		expect(result.droppedByReason).toEqual([TEXT_DROPPED]);
	});

	it("keeps a bounded prefix of an oversized single line", () => {
		const result = admitClipboardPlainText("x".repeat(CLIPBOARD_INGEST_MAX_TEXT_SIZE + 1), "paragraph", editor);
		expect(result.blocks[0].content?.length).toBe(CLIPBOARD_INGEST_MAX_TEXT_SIZE);
		expect(result.droppedByReason[0].reason).toBe("text-size-exceeded");
	});

	it("bounds the number of recovered lines", () => {
		const lines = Array(CLIPBOARD_INGEST_MAX_NODE_COUNT + 5).fill("line");
		const result = admitClipboardPlainText(lines.join("\n"), "paragraph", editor);
		expect(result.blocks).toHaveLength(CLIPBOARD_INGEST_MAX_NODE_COUNT);
		expect(result.droppedByReason).toEqual([NODES_DROPPED]);
	});
});

describe("SEC4 clipboard JSON ingest bounds", () => {
	it("SEC4: drops blocks past depth 32", () => {
		const result = admitClipboardBlocks([nestToggles(CLIPBOARD_INGEST_MAX_NESTING_DEPTH + 1)], editor);

		expect(result.droppedByReason).toEqual([
			{ reason: "depth-exceeded", count: 1, bound: "CLIPBOARD_INGEST_MAX_NESTING_DEPTH" },
		]);
		let depth = 0;
		for (let current: PenBlock | undefined = result.blocks[0]; current; current = current.children?.[0]) {
			depth += 1;
		}
		expect(depth).toBe(CLIPBOARD_INGEST_MAX_NESTING_DEPTH);
	});

	it.each([
		{
			cap: "10k node cap",
			blocks: Array.from({ length: CLIPBOARD_INGEST_MAX_NODE_COUNT + 5 }, () => ({ type: "paragraph", content: "n" })),
			kept: CLIPBOARD_INGEST_MAX_NODE_COUNT,
			dropped: NODES_DROPPED,
		},
		{
			cap: "1 MiB text cap",
			blocks: [
				{ type: "paragraph", content: "x".repeat(CLIPBOARD_INGEST_MAX_TEXT_SIZE) },
				{ type: "paragraph", content: "overflow" },
			],
			kept: 1,
			keptText: CLIPBOARD_INGEST_MAX_TEXT_SIZE,
			dropped: TEXT_DROPPED,
		},
		{
			cap: "256 image cap",
			blocks: Array.from({ length: CLIPBOARD_INGEST_MAX_IMAGE_COUNT + 2 }, (_, index) => ({
				type: "image",
				props: { src: `https://example.com/${index}.png` },
			})),
			kept: CLIPBOARD_INGEST_MAX_IMAGE_COUNT,
			dropped: { reason: "image-count-exceeded", count: 2, bound: "CLIPBOARD_INGEST_MAX_IMAGE_COUNT" },
		},
	])("SEC4 IOP5: drops blocks past the $cap", ({ blocks, kept, keptText, dropped }) => {
		const result = admitClipboardBlocks(blocks as PenBlock[], editor);
		expect(result.blocks).toHaveLength(kept);
		if (keptText !== undefined) expect(result.blocks[0]?.content).toHaveLength(keptText);
		expect(result.droppedByReason).toEqual([dropped]);
	});
});
