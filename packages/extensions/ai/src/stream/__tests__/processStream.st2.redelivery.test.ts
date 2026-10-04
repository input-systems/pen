import { createEditor } from "@input/pen-core";
import type { PenStreamPart } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { processStream } from "../processStream";
import { createStream, createStreamEditor } from "./processStream.testHelpers";

function bodyText(editor: ReturnType<typeof createEditor>): string {
	return editor.documentState.blockOrder
		.map((blockId) => editor.getBlock(blockId)?.textContent() ?? "")
		.join("\n");
}

/**
 * ST2 holds the write head as an anchor and resolves it before each flush
 * splices, with no length tracking and no wire position. That makes a text
 * delta a relative effect, so a transport that delivers one twice writes it
 * twice, and no `gen-delta` field could tell the consumer which of the two it
 * is receiving — the part carries its zone and its text and nothing else.
 * Resume therefore belongs inside the transport, keyed on an offset it owns;
 * replaying parts into `processStream` corrupts the document.
 */
describe("@input/pen-ai/stream processStream re-delivery", () => {
	it("ST2: a re-delivered gen-delta appends its text a second time", async () => {
		const editor = createStreamEditor();
		const blockId = editor.firstBlock()!.id;

		await processStream(
			createStream([
				{ type: "gen-start", zoneId: "zone-1", blockId },
				{ type: "gen-delta", zoneId: "zone-1", delta: "Hello world" },
				{ type: "gen-delta", zoneId: "zone-1", delta: "Hello world" },
				{ type: "gen-end", zoneId: "zone-1", status: "complete" },
			]),
			editor,
			{ groupId: "turn-1" },
		);

		expect(bodyText(editor)).toBe("Hello worldHello world");

		editor.destroy();
	});

	it("ST2: replaying a whole generation duplicates what already landed", async () => {
		const editor = createStreamEditor();
		const blockId = editor.firstBlock()!.id;
		const parts: PenStreamPart[] = [
			{ type: "gen-start", zoneId: "zone-1", blockId },
			{ type: "gen-delta", zoneId: "zone-1", delta: "Hello world" },
			{ type: "gen-end", zoneId: "zone-1", status: "complete" },
		];

		await processStream(createStream(parts), editor, { groupId: "turn-1" });
		expect(bodyText(editor)).toBe("Hello world");

		await processStream(createStream(parts), editor, { groupId: "turn-1" });
		expect(bodyText(editor)).toBe("Hello worldHello world");

		editor.destroy();
	});
});
