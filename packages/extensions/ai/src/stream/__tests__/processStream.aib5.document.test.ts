import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { describe, expect, it } from "vitest";

import { processStream } from "../processStream";
import {
	createStream,
	createStreamEditor,
	listenDiagnostics,
} from "./processStream.testHelpers";

describe("@input/pen-ai/stream processStream AIB5 document", () => {
	it("AIB5: bare createEditor without deltaStreamExtension refuses the stream", async () => {
		const editor = createEditor({ schema: defaultSchema });
		const diagnostics = listenDiagnostics(editor);

		await expect(
			processStream(
				createStream([
					{
						type: "block-insert",
						blockId: "should-not-land",
						blockType: "paragraph",
						position: "last",
					},
				]),
				editor,
			),
		).resolves.toBeUndefined();

		expect(editor.getBlock("should-not-land")).toBeNull();
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "stream-target-missing",
				source: "delta-stream",
			}),
		]);

		editor.destroy();
	});

	it("AIB5: malformed part leaves a consistent document and closes the remaining stream", async () => {
		const editor = createStreamEditor();
		const diagnostics = listenDiagnostics(editor);
		const seedId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: seedId,
					from: 0,
					to: 0,
					insert: "seed",
				},
			],
			{ origin: "user" },
		);

		await expect(
			processStream(
				createStream([
					{
						type: "block-insert",
						blockId: "landed-prefix",
						blockType: "paragraph",
						position: "last",
					},
					{
						type: "block-update",
						blockId: "",
						props: { text: "nope" },
					},
					{
						type: "block-insert",
						blockId: "after-malformed",
						blockType: "paragraph",
						position: "last",
					},
				]),
				editor,
				{
					groupId: "malformed-turn",
					allowedMutatingTools: ["insert_block"],
				},
			),
		).resolves.toBeUndefined();

		expect(editor.getBlock("landed-prefix")).toBeTruthy();
		expect(editor.getBlock("after-malformed")).toBeNull();
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "stream-part-malformed",
				groupId: "malformed-turn",
			}),
		]);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: seedId,
					from: 4,
					to: 4,
					insert: " still-writable",
				},
			],
			{ origin: "user" },
		);
		expect(editor.getBlock(seedId)?.textContent()).toContain(
			"still-writable",
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(seedId)?.textContent()).toBe("seed");
		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock("landed-prefix")).toBeNull();
		expect(editor.getBlock(seedId)?.textContent()).toBe("seed");

		editor.destroy();
	});

	it("AIB5: out-of-order gen-delta leaves a consistent document and closes the stream", async () => {
		const editor = createStreamEditor();
		const diagnostics = listenDiagnostics(editor);

		await expect(
			processStream(
				createStream([
					{
						type: "block-insert",
						blockId: "landed-prefix",
						blockType: "paragraph",
						position: "last",
					},
					{ type: "gen-delta", zoneId: "zone-1", delta: "hello" },
					{
						type: "block-insert",
						blockId: "after-ooo",
						blockType: "paragraph",
						position: "last",
					},
				]),
				editor,
				{
					groupId: "ooo-turn",
					allowedMutatingTools: ["insert_block"],
				},
			),
		).resolves.toBeUndefined();

		expect(editor.getBlock("landed-prefix")).toBeTruthy();
		expect(editor.getBlock("after-ooo")).toBeNull();
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "stream-part-out-of-order",
				groupId: "ooo-turn",
			}),
		]);

		editor.destroy();
	});

	it("AIB4 AIB5: one undo reverts the prefix that landed before a malformed part", async () => {
		const editor = createStreamEditor();
		const seedId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: seedId,
					from: 0,
					to: 0,
					insert: "before",
				},
			],
			{ origin: "user" },
		);
		const before = editor.documentState.blockOrder.map(
			(blockId) => editor.getBlock(blockId)?.textContent() ?? "",
		);

		await processStream(
			createStream([
				{
					type: "block-insert",
					blockId: "prefix-a",
					blockType: "paragraph",
					position: "last",
				},
				{
					type: "block-insert",
					blockId: "prefix-b",
					blockType: "paragraph",
					position: "last",
				},
				{
					type: "block-update",
					blockId: "",
					props: { text: "nope" },
				},
			]),
			editor,
			{
				groupId: "malformed-undo",
				allowedMutatingTools: ["insert_block"],
			},
		);

		expect(editor.getBlock("prefix-a")).toBeTruthy();
		expect(editor.getBlock("prefix-b")).toBeTruthy();

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock("prefix-a")).toBeNull();
		expect(editor.getBlock("prefix-b")).toBeNull();
		expect(
			editor.documentState.blockOrder.map(
				(blockId) => editor.getBlock(blockId)?.textContent() ?? "",
			),
		).toEqual(before);

		editor.destroy();
	});
});
