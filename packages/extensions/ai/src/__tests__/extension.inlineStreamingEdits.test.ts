import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "../stream";
import { toolsExtension } from "@input/pen-tools";
import { aiExtension, getAIController } from "../index";
import { defaultSchema } from "@input/pen-schema";
import {
	createSingleDeltaEditor,
	testStreamingToolExtension,
} from "./extension.testUtils";

async function awaitExtensionLifecycle(
	editor: ReturnType<typeof createEditor>,
): Promise<void> {
	await editor.whenReady();
}

describe("aiExtension: inline streaming edits", () => {
	it("routes inline local-edit prompts to block streaming suggestions", async () => {
		const editor = createSingleDeltaEditor(" Better version");
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello world",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange({ blockId, offset: 6 }, { blockId, offset: 11 });

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});

		const generation = await controller.runSessionPrompt(
			session.id,
			"Make it better",
		);

		expect(generation.target).toBe("selection");
		expect(generation.mutationMode).toBe("streaming-suggestions");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
	});

	it("streams continuation onto the target block", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " AI" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello world",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange({ blockId, offset: 5 }, { blockId, offset: 5 });

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt(
			"Continue this paragraph",
			{
				target: "block",
				blockId,
			},
		);

		expect(generation.target).toBe("block");
		expect(generation.route).toBe("cursor-context");
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world AI");
	});

	it("uses the selection end as the insertion offset for inline block turns", async () => {
		const editor = createSingleDeltaEditor(" Better");
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello world",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange({ blockId, offset: 6 }, { blockId, offset: 11 });

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Make it better",
		);

		expect(generation.target).toBe("selection");
		expect(generation.mutationMode).toBe("streaming-suggestions");
		const suggestions = controller.getSuggestions();
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions[0]?.blockId).toBe(blockId);
	});

	it("creates reviewable cross-block inline edit suggestions", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "X" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "b2",
				from: 0,
				to: 0,
				insert: "World",
			},
			{
				type: "splice-text",
				blockId: "b3",
				from: 0,
				to: 0,
				insert: "Again",
			},
		]);
		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 2 },
			{ blockId: "b3", offset: 2 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Rewrite the selection",
		);
		const nextSession = controller.getActiveSession();
		const turn = nextSession?.turns[0];

		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		expect(turn?.selection?.isMultiBlock).toBe(true);
		expect(turn?.status).toBe("review");
		expect(controller.acceptSessionTurn(session.id, turn!.id)).toBe(true);
		expect(
			editor.getBlock(firstBlockId)?.textContent({ resolved: true }),
		).toBe("HeXain");
		expect(editor.getBlock("b2")).toBeNull();
		expect(editor.getBlock("b3")).toBeNull();
	});

	it("records progressive tool stream events for the active generation", async () => {
		let pass = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					allowedMutatingTools: ["test_search"],
					model: {
						async *stream() {
							pass += 1;
							if (pass === 1) {
								yield {
									type: "tool-call" as const,
									toolCallId: "tool-call-1",
									toolName: "test_search",
									input: { query: "plan" },
								};
							}
							yield { type: "done" as const };
						},
					},
				}),
				testStreamingToolExtension(),
			],
		});
		await awaitExtensionLifecycle(editor);
		const controller = getAIController(editor)!;
		const blockId = editor.firstBlock()!.id;

		const generation = await controller.runPrompt("search the document", {
			blockId,
		});
		const streamEvents = controller.getStreamEvents();
		const streamEventTypes = streamEvents.map((event) => event.type);
		const toolOutputEvents = streamEvents.filter(
			(event) => event.type === "tool-output",
		);
		const toolResultEvent = streamEvents.find(
			(event) => event.type === "tool-result",
		);

		expect(generation.status).toBe("complete");
		expect(streamEventTypes).toEqual([
			"generation-start",
			"status",
			"tool-call",
			"status",
			"tool-output",
			"tool-output",
			"tool-result",
			"status",
			"generation-finish",
		]);
		expect(toolOutputEvents).toHaveLength(2);
		expect(toolOutputEvents[0]).toMatchObject({
			toolCallId: "tool-call-1",
			toolName: "test_search",
			part: "searching:plan",
			output: "searching:plan",
		});
		expect(toolOutputEvents[1]).toMatchObject({
			toolCallId: "tool-call-1",
			toolName: "test_search",
			part: { matches: 2, query: "plan" },
			output: ["searching:plan", { matches: 2, query: "plan" }],
		});
		expect(toolResultEvent).toMatchObject({
			type: "tool-result",
			toolCallId: "tool-call-1",
			toolName: "test_search",
			output: ["searching:plan", { matches: 2, query: "plan" }],
			state: "complete",
		});
	});
});
