import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import {
	toolsExtension,
	getDocumentToolRuntime,
} from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { createModelDouble } from "@input/pen-test";
import { undoExtension } from "@input/pen-undo";
import type { ModelStreamEvent } from "@input/pen-types";
import { getAIController, runAgenticLoop } from "../index";
import { createChatEditor } from "./editChannel.testHelpers";

interface OutlineEntry {
	blockId: string;
	blockType: string;
}

function seedDocument(editor: ReturnType<typeof createEditor>): {
	headingId: string;
	introId: string;
} {
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
				blockId: "intro",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "intro",
				from: 0,
				to: 0,
				insert: "This report covers the third quarter.",
			},
		],
		{ origin: "system" },
	);
	return { headingId, introId: "intro" };
}

function outlineFromRequest(request: { messages: unknown }): OutlineEntry[] {
	const serialized = JSON.stringify(request.messages);
	const entries: OutlineEntry[] = [];
	const pattern = /"blockId":"([^"]+)","blockType":"([^"]+)"/g;
	for (const match of serialized.matchAll(pattern)) {
		entries.push({ blockId: match[1]!, blockType: match[2]! });
	}
	return entries;
}

function liveParagraphIdFromOutline(request: { messages: unknown }): string {
	const paragraph = outlineFromRequest(request).find(
		(entry) => entry.blockType === "paragraph",
	);
	expect(paragraph).toBeTruthy();
	return paragraph!.blockId;
}

describe("EC9: a stale read is corrected, not cancelled", () => {
	it("EC9: concurrent text edit is refused then retried in the same turn", async () => {
		let passes = 0;
		let refusalPayload = "";
		const editor = createChatEditor({
			async *stream(request) {
				passes += 1;
				if (passes === 1) {
					const intro = editor.getBlock("intro")!;
					editor.apply(
						[
							{
								type: "splice-text",
								blockId: "intro",
								from: 0,
								to: intro.textContent().length,
								insert: "Concurrent rewrite.",
							},
						],
						{ origin: "system" },
					);
					yield {
						type: "tool-call",
						toolCallId: "edit-stale",
						toolName: "edit_document",
						input: {
							operations: [
								{
									operation: "replace_block_text",
									blockId: "intro",
									text: "Stale rewrite.",
								},
							],
						},
					} as ModelStreamEvent;
					yield { type: "done" } as ModelStreamEvent;
					return;
				}
				refusalPayload = JSON.stringify(
					(request as { messages: unknown }).messages,
				);
				yield {
					type: "tool-call",
					toolCallId: "edit-retry",
					toolName: "edit_document",
					input: {
						operations: [
							{
								operation: "replace_block_text",
								blockId: liveParagraphIdFromOutline(
									request as { messages: unknown },
								),
								text: "Corrected rewrite.",
							},
						],
					},
				} as ModelStreamEvent;
				yield { type: "done" } as ModelStreamEvent;
			},
		});
		await editor.whenReady();
		seedDocument(editor);

		const generation = await getAIController(editor)!.runPrompt(
			"Rewrite the intro.",
			{ target: "document" },
		);

		expect(generation.status).toBe("complete");
		expect(generation.status).not.toBe("cancelled");
		expect(generation.editsArriveAsToolCalls).toBe(true);
		expect(passes).toBeGreaterThanOrEqual(2);
		expect(refusalPayload).toMatch(
			/stale-target|view-changed|unknown-block/,
		);
		expect(refusalPayload).toContain("outline");
		expect(editor.getBlock("intro")?.textContent()).toBe(
			"Corrected rewrite.",
		);
		expect(editor.getBlock("intro")?.textContent()).not.toBe(
			"Stale rewrite.",
		);

		editor.destroy();
	});

	it("EC9: a props-only change that leaves rendered markdown identical is not refused", async () => {
		let passes = 0;
		const editor = createChatEditor({
			async *stream(request) {
				passes += 1;
				if (passes === 1) {
					const selection = editor.selection;
					editor.apply(
						[
							{
								type: "set-props",
								blockId: "intro",
								props: { direction: "rtl" },
							},
						],
						{ origin: "system" },
					);
					editor.setSelection(selection);
					yield {
						type: "tool-call",
						toolCallId: "edit-fresh",
						toolName: "edit_document",
						input: {
							operations: [
								{
									operation: "replace_block_text",
									blockId: "intro",
									text: "Props-only still applies.",
								},
							],
						},
					} as ModelStreamEvent;
					yield { type: "done" } as ModelStreamEvent;
				}
			},
		});
		await editor.whenReady();
		seedDocument(editor);

		const generation = await getAIController(editor)!.runPrompt(
			"Rewrite the intro.",
			{ target: "document" },
		);

		expect(generation.status).toBe("complete");
		expect(generation.status).not.toBe("cancelled");
		expect(passes).toBe(1);
		expect(JSON.stringify(generation.steps)).not.toMatch(
			/stale-target|view-changed/,
		);
		expect(editor.getBlock("intro")?.props.direction).toBe("rtl");
		expect(editor.getBlock("intro")?.textContent()).toBe(
			"Props-only still applies.",
		);

		editor.destroy();
	});
});

// EC9 moved the loop's stale branch, which the legacy channel shares. GATE
// 0.13's full suite does not reach it: no controller-level test produces a
// stale set the loop then re-validates, so both sides are asserted here at
// the loop seam, the way AIB2/AIB4 assert theirs.
async function loopWithStaleWorkingSetAfterFirstPass(options: {
	editsArriveAsToolCalls?: boolean;
	refreshWorkingSet?: () => Promise<null>;
}): Promise<{ passes: number; validations: number }> {
	const editor = createEditor({
		schema: defaultSchema,
		extensions: [undoExtension(), toolsExtension()],
	});
	await editor.whenReady();
	const toolRuntime = getDocumentToolRuntime(editor)!;
	toolRuntime.registerTool({
		name: "peek_document",
		description: "Read-only peek, so the pass does not end the turn",
		mutating: false,
		inputSchema: { type: "object", properties: {} },
		async handler() {
			return "peeked";
		},
	});

	const blockId = editor.firstBlock()!.id;
	let validations = 0;
	const double = createModelDouble({
		responses: [
			{
				toolCalls: [
					{
						toolCallId: "peek-1",
						toolName: "peek_document",
						input: {},
					},
				],
			},
			{ text: "done" },
		],
	});

	try {
		await runAgenticLoop({
			model: double,
			editor,
			toolRuntime,
			prompt: "Peek, then answer",
			blockId,
			editsArriveAsToolCalls: options.editsArriveAsToolCalls,
			refreshWorkingSet: options.refreshWorkingSet,
			validateWorkingSet: () => {
				validations += 1;
				return validations === 1
					? { valid: true, canRefresh: false }
					: {
							valid: false,
							canRefresh: false,
							reason: "view-changed",
						};
			},
		});
		return { passes: double.requests.length, validations };
	} finally {
		editor.destroy();
	}
}

describe("EC9: the shared stale branch continues the turn", () => {
	it("EC9: the edit channel continues the turn instead of throwing", async () => {
		const { passes, validations } =
			await loopWithStaleWorkingSetAfterFirstPass({
				editsArriveAsToolCalls: true,
			});

		// The second pass ran, so the stale check was reached and did not throw.
		expect(validations).toBeGreaterThanOrEqual(2);
		expect(passes).toBe(2);
	});

	it("EC9: the edit channel refreshes even when the validator says it cannot", async () => {
		let refreshes = 0;
		const { passes } = await loopWithStaleWorkingSetAfterFirstPass({
			editsArriveAsToolCalls: true,
			refreshWorkingSet: async () => {
				refreshes += 1;
				return null;
			},
		});

		expect(refreshes).toBeGreaterThanOrEqual(1);
		expect(passes).toBe(2);
	});
});
