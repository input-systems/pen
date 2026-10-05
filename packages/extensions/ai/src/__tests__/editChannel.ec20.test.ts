import { createEditor } from "@input/pen-core";
import {
	toolsExtension,
	getDocumentToolRuntime,
} from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import type { ModelAdapter, ModelStreamEvent } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { describe, expect, it } from "vitest";
import { runAgenticLoop } from "../agentic/loop";
import { aiExtension, getAIController } from "../index";
import { splitCommittableMarkdown } from "../runtime/streamingBlockCommit";
import { deltaStreamExtension } from "../stream";
import type { AIEditStreaming } from "../types";
import { BLOCK_ANNOTATION_PATTERN } from "./editChannel.testHelpers";

const PROMPT = "Add a findings section.";
const PAYLOAD = "## Findings\n\nRevenue grew.\n\n- One\n- Two";

function blockIds(request: { messages: unknown }): string[] {
	const ids = [
		...JSON.stringify(request.messages).matchAll(BLOCK_ANNOTATION_PATTERN),
	].map((match) => match[1]!);
	expect(ids.length).toBeGreaterThan(0);
	return ids;
}

function lastBlockId(request: { messages: unknown }): string {
	return blockIds(request).at(-1)!;
}

function snapshot(editor: ReturnType<typeof createEditor>) {
	return Array.from(editor.blocks()).map((block) => ({
		type: block.type,
		text: block.textContent(),
	}));
}

function createChatEditor(
	model: ModelAdapter,
	options?: {
		mutationPreference?: "direct" | "suggestions";
		editStreaming?: AIEditStreaming;
		confirm?: () => "allow" | "refuse";
	},
) {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({
				model,
				contentFormat: { blockGeneration: "markdown" },
				mutationPreference: options?.mutationPreference ?? "direct",
				editStreaming: options?.editStreaming ?? "commit",
				allowedMutatingTools: ["edit_document"],
				...(options?.confirm ? { confirm: options.confirm } : {}),
			}),
		],
	});
}

function seedDocument(editor: ReturnType<typeof createEditor>): void {
	const firstId = editor.firstBlock()!.id;
	editor.apply(
		[
			{
				type: "splice-text",
				blockId: firstId,
				from: 0,
				to: 0,
				insert: "Quarterly report.",
			},
		],
		{ origin: "system" },
	);
}

/** Two paragraphs, so two operations can address different targets. */
function seedTwoBlockDocument(editor: ReturnType<typeof createEditor>): void {
	seedDocument(editor);
	editor.apply(
		[
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
				insert: "Closing note.",
			},
		],
		{ origin: "system" },
	);
}

/**
 * Streams an `insert_blocks` payload one fragment at a time, letting the test
 * look at the document between fragments — the only way to tell a block that
 * arrived while the call was open from one that arrived when it closed.
 */
function streamingInsertModel(options: {
	payload?: string;
	onFragment?: (index: number) => void;
	endWith?: "tool-call" | "error" | "done";
}): ModelAdapter {
	const payload = options.payload ?? PAYLOAD;
	return {
		capabilities: { partialToolInput: true },
		async *stream(request) {
			const serialized = JSON.stringify(request.messages);
			if (serialized.includes('"role":"tool"')) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			const input = {
				operations: [
					{
						operation: "insert_blocks",
						blockId: lastBlockId(request as { messages: unknown }),
						placement: "after",
						markdown: payload,
					},
				],
			};
			const json = JSON.stringify(input);
			yield {
				type: "tool-input-start",
				toolCallId: "edit-1",
				toolName: "edit_document",
			} as ModelStreamEvent;
			let fragment = 0;
			for (let index = 0; index < json.length; index += 12) {
				yield {
					type: "tool-input-delta",
					toolCallId: "edit-1",
					inputTextDelta: json.slice(index, index + 12),
				} as ModelStreamEvent;
				options.onFragment?.(fragment++);
			}
			if (options.endWith === "error") {
				yield {
					type: "error",
					error: new Error("stream failed"),
				} as ModelStreamEvent;
				return;
			}
			if (options.endWith === "done") {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			yield {
				type: "tool-call",
				toolCallId: "edit-1",
				toolName: "edit_document",
				input,
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

/**
 * Two `insert_blocks` operations addressing different blocks — the shape of
 * "edit the title, then extend the last paragraph" once both halves insert.
 */
function multiOperationModel(onFragment: () => void): ModelAdapter {
	return {
		capabilities: { partialToolInput: true },
		async *stream(request) {
			if (JSON.stringify(request.messages).includes('"role":"tool"')) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			const ids = blockIds(request as { messages: unknown });
			const input = {
				operations: [
					{
						operation: "insert_blocks",
						blockId: ids[0],
						placement: "after",
						markdown: "## Findings\n\nRevenue grew.",
					},
					{
						operation: "insert_blocks",
						blockId: ids.at(-1),
						placement: "after",
						markdown: "- One\n\n- Two",
					},
				],
			};
			yield* streamJsonInput("edit-multi", input, onFragment);
			yield {
				type: "tool-call",
				toolCallId: "edit-multi",
				toolName: "edit_document",
				input,
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

function* streamJsonInput(
	toolCallId: string,
	input: unknown,
	onFragment?: () => void,
): Generator<ModelStreamEvent> {
	const json = JSON.stringify(input);
	yield {
		type: "tool-input-start",
		toolCallId,
		toolName: "edit_document",
	} as ModelStreamEvent;
	for (let index = 0; index < json.length; index += 12) {
		yield {
			type: "tool-input-delta",
			toolCallId,
			inputTextDelta: json.slice(index, index + 12),
		} as ModelStreamEvent;
		onFragment?.();
	}
}

/** Runs the four-block insert under an explicit turn budget. */
async function runBudgetedInsert(
	maxTotalOpsPerTurn: number,
): Promise<string[]> {
	const editor = createChatEditor({
		capabilities: { partialToolInput: true },
		async *stream() {
			yield { type: "done" } as ModelStreamEvent;
		},
	});
	await editor.whenReady();
	seedDocument(editor);
	const anchorId = editor.firstBlock()!.id;
	const input = {
		operations: [
			{
				operation: "insert_blocks",
				blockId: anchorId,
				placement: "after",
				markdown: PAYLOAD,
			},
		],
	};

	await runAgenticLoop({
		model: {
			capabilities: { partialToolInput: true },
			async *stream() {
				yield* streamJsonInput("edit-budget", input);
				yield {
					type: "tool-call",
					toolCallId: "edit-budget",
					toolName: "edit_document",
					input,
				} as ModelStreamEvent;
				yield { type: "done" } as ModelStreamEvent;
			},
		},
		editor,
		toolRuntime: getDocumentToolRuntime(editor)!,
		prompt: PROMPT,
		blockId: anchorId,
		editsArriveAsToolCalls: true,
		editStreaming: "commit",
		allowedMutatingTools: ["edit_document"],
		toolBudget: { maxTotalOpsPerTurn },
	});

	const texts = snapshot(editor).map((block) => block.text);
	editor.destroy();
	return texts;
}

describe("EC20: completed blocks are written while the call is still open", () => {
	it("EC20: a blank line outside a fence is the boundary, and the last chunk is held back", () => {
		expect(splitCommittableMarkdown("## Findings\n\n")).toEqual({
			committed: "",
			tail: "## Findings\n\n",
		});
		expect(splitCommittableMarkdown("## Findings\n\nRevenue")).toEqual({
			committed: "## Findings\n\n",
			tail: "Revenue",
		});
		// A single newline may be a lazy continuation of the same paragraph.
		expect(splitCommittableMarkdown("One line\nstill the same")).toEqual({
			committed: "",
			tail: "One line\nstill the same",
		});
		// A blank line inside a fence is part of the code, not a boundary.
		expect(
			splitCommittableMarkdown("```js\nconst a = 1;\n\nconst b = 2;"),
		).toEqual({
			committed: "",
			tail: "```js\nconst a = 1;\n\nconst b = 2;",
		});
	});

	it("EC20: blocks appear before the call closes, and closing does not repeat them", async () => {
		let editor!: ReturnType<typeof createEditor>;
		const seen: string[][] = [];
		const model = streamingInsertModel({
			onFragment: () => {
				seen.push(
					snapshot(editor)
						.filter((block) => block.text.length > 0)
						.map((block) => block.text),
				);
			},
		});
		editor = createChatEditor(model);
		await editor.whenReady();
		seedDocument(editor);

		await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		const duringStream = seen.at(-1) ?? [];
		expect(duringStream).toContain("Findings");
		expect(duringStream).toContain("Revenue grew.");
		// The tail is still a preview at that point, not a block.
		expect(duringStream).not.toContain("One");

		expect(snapshot(editor)).toEqual([
			{ type: "paragraph", text: "Quarterly report." },
			{ type: "heading", text: "Findings" },
			{ type: "paragraph", text: "Revenue grew." },
			{ type: "bulletListItem", text: "One" },
			{ type: "bulletListItem", text: "Two" },
		]);
	});

	it("EC20: a stream that dies before the call closes leaves nothing behind", async () => {
		const model = streamingInsertModel({ endWith: "error" });
		const editor = createChatEditor(model);
		await editor.whenReady();
		seedDocument(editor);

		await getAIController(editor)!
			.runPrompt(PROMPT, { target: "document" })
			.catch(() => undefined);

		expect(snapshot(editor)).toEqual([
			{ type: "paragraph", text: "Quarterly report." },
		]);
	});

	it("EC20: fragments without a closing call leave nothing behind", async () => {
		const model = streamingInsertModel({ endWith: "done" });
		const editor = createChatEditor(model);
		await editor.whenReady();
		seedDocument(editor);

		await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		expect(snapshot(editor)).toEqual([
			{ type: "paragraph", text: "Quarterly report." },
		]);
	});

	it("EC20: a turn that must be confirmed writes nothing before the call closes", async () => {
		let editor!: ReturnType<typeof createEditor>;
		const seen: number[] = [];
		const model = streamingInsertModel({
			onFragment: () => {
				seen.push(Array.from(editor.blocks()).length);
			},
		});
		editor = createChatEditor(model, { confirm: () => "allow" });
		await editor.whenReady();
		seedDocument(editor);

		await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		expect(Math.max(...seen)).toBe(1);
		expect(snapshot(editor).map((block) => block.text)).toEqual([
			"Quarterly report.",
			"Findings",
			"Revenue grew.",
			"One",
			"Two",
		]);
	});

	it('EC20: editStreaming "preview" shows the text and writes none of it', async () => {
		let editor!: ReturnType<typeof createEditor>;
		const seen: number[] = [];
		const model = streamingInsertModel({
			onFragment: () => {
				seen.push(Array.from(editor.blocks()).length);
			},
		});
		editor = createChatEditor(model, { editStreaming: "preview" });
		await editor.whenReady();
		seedDocument(editor);

		await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		expect(Math.max(...seen)).toBe(1);
		expect(snapshot(editor).map((block) => block.text)).toEqual([
			"Quarterly report.",
			"Findings",
			"Revenue grew.",
			"One",
			"Two",
		]);
	});

	it("EC20: every operation in the payload streams into its own target", async () => {
		let editor!: ReturnType<typeof createEditor>;
		const seen: Array<Array<{ type: string; text: string }>> = [];
		const model = multiOperationModel(() => {
			seen.push(
				snapshot(editor).filter((block) => block.text.length > 0),
			);
		});
		editor = createChatEditor(model);
		await editor.whenReady();
		seedTwoBlockDocument(editor);

		await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		// The second operation's blocks land under the block *it* names. Read
		// from the payload at large, its markdown would have been attributed to
		// the first operation's target and appeared under "Quarterly report."
		const duringStream = seen.at(-1)!.map((block) => block.text);
		expect(duringStream).toEqual([
			"Quarterly report.",
			"Findings",
			"Closing note.",
			"One",
		]);
		expect(snapshot(editor)).toEqual([
			{ type: "paragraph", text: "Quarterly report." },
			{ type: "heading", text: "Findings" },
			{ type: "paragraph", text: "Revenue grew." },
			{ type: "paragraph", text: "Closing note." },
			{ type: "bulletListItem", text: "One" },
			{ type: "bulletListItem", text: "Two" },
		]);
	});

	it("EC20: streamed writes are charged against the turn's op budget", async () => {
		// Writing a block is two ops (`insert-block` plus its text), so the
		// four-block payload is eight: four written while the call streams,
		// four left for the call itself. Eight fits exactly, which is the
		// probe that nothing is charged twice.
		expect(await runBudgetedInsert(8)).toEqual([
			"Quarterly report.",
			"Findings",
			"Revenue grew.",
			"One",
			"Two",
		]);

		// Six does not fit. The closing half alone would have — so if streamed
		// writes were free, this turn would have written eight ops under a
		// six-op budget, four of them uncounted.
		expect(await runBudgetedInsert(6)).toEqual(["Quarterly report."]);
	});

	it("EC20: under the suggestions posture the early blocks are staged, not durable", async () => {
		let editor!: ReturnType<typeof createEditor>;
		const stagedDuringStream: string[] = [];
		const model = streamingInsertModel({
			onFragment: () => {
				for (const block of editor.blocks()) {
					if (
						block.meta("suggestion") != null &&
						!stagedDuringStream.includes(block.id)
					) {
						stagedDuringStream.push(block.id);
					}
				}
			},
		});
		editor = createChatEditor(model, {
			mutationPreference: "suggestions",
		});
		await editor.whenReady();
		seedDocument(editor);

		await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		expect(stagedDuringStream.length).toBeGreaterThan(0);
	});
});
