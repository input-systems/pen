import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { toolsExtension } from "@input/pen-tools";
import type { Editor, ModelAdapter, ModelStreamEvent } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { aiExtension, getAIController } from "../index";
import { deltaStreamExtension } from "../stream";
import type { AIToolConfirmFn, AIUnconfirmedDestructivePolicy } from "../tools";
import { documentHash } from "./fixtures/documentHash";
import {
	seedEditChannelCorpus,
	type EditChannelCorpusSeed,
} from "./fixtures/editChannelCorpus";

/**
 * AIB3 / D6 through the real controller: whether `confirm` is consulted
 * depends on the call — its posture and what it removes — not on the tool.
 */

const EMPTY_BLOCK_ID = "empty";
const PROMPT = "Edit the document.";

let editor: Editor | null = null;

afterEach(() => {
	editor?.destroy();
	editor = null;
});

/** One `edit_document` call, delivered whole; the next pass ends the turn. */
function scriptedEditModel(
	operations: (seed: EditChannelCorpusSeed) => unknown[],
	seedRef: { current: EditChannelCorpusSeed | null },
): ModelAdapter {
	let passes = 0;
	return {
		async *stream() {
			passes += 1;
			if (passes === 1) {
				yield {
					type: "tool-call",
					toolCallId: "aib3-call",
					toolName: "edit_document",
					input: { operations: operations(seedRef.current!) },
				} as ModelStreamEvent;
			}
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

async function runEdit(options: {
	posture: "direct" | "suggestions";
	operations: (seed: EditChannelCorpusSeed) => unknown[];
	confirm?: AIToolConfirmFn;
	unconfirmedDestructive?: AIUnconfirmedDestructivePolicy;
}) {
	const seedRef: { current: EditChannelCorpusSeed | null } = {
		current: null,
	};
	editor = createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({
				model: scriptedEditModel(options.operations, seedRef),
				contentFormat: { blockGeneration: "markdown" },
				mutationPreference: options.posture,
				editStreaming: "atomic",
				allowedMutatingTools: ["edit_document"],
				confirm: options.confirm,
				unconfirmedDestructive: options.unconfirmedDestructive,
			}),
		],
	});
	await editor.whenReady();
	const seed = seedEditChannelCorpus(editor);
	editor.apply(
		[
			{
				type: "insert-block",
				blockId: EMPTY_BLOCK_ID,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		],
		{ origin: "system" },
	);
	seedRef.current = seed;
	const before = documentHash(editor);
	const generation = await getAIController(editor)!.runPrompt(PROMPT, {
		target: "document",
	});
	return { editor, seed, before, generation };
}

function allowSpy() {
	return vi.fn<AIToolConfirmFn>(() => "allow");
}

describe("AIB3: edit_document consults confirm per call", () => {
	it("AIB3: a staged edit_document call never consults confirm", async () => {
		const confirm = allowSpy();
		const { generation } = await runEdit({
			posture: "suggestions",
			confirm,
			operations: (seed) => [
				{ operation: "delete_blocks", blockIds: [seed.introId] },
				{
					operation: "replace_block_text",
					blockId: seed.closingId,
					text: "Revenue grew.",
				},
			],
		});
		expect(generation.status).toBe("complete");
		expect(confirm).not.toHaveBeenCalled();
		expect(
			getAIController(editor!)!.getSuggestions().length,
		).toBeGreaterThan(0);
	});

	it("AIB3: a direct edit_document insert never consults confirm", async () => {
		const confirm = allowSpy();
		await runEdit({
			posture: "direct",
			confirm,
			operations: (seed) => [
				{
					operation: "insert_blocks",
					blockId: seed.introId,
					placement: "after",
					markdown: "A new paragraph.",
				},
			],
		});
		expect(confirm).not.toHaveBeenCalled();
		expect(
			Array.from(editor!.blocks()).some(
				(block) => block.textContent() === "A new paragraph.",
			),
		).toBe(true);
	});

	it("AIB3: a direct edit_document format never consults confirm", async () => {
		const confirm = allowSpy();
		await runEdit({
			posture: "direct",
			confirm,
			operations: (seed) => [
				{
					operation: "format_text",
					blockId: seed.bodyIds[0],
					matchText: seed.productName,
					marks: { bold: true },
				},
			],
		});
		expect(confirm).not.toHaveBeenCalled();
	});

	it("AIB3: a direct edit_document replace consults confirm", async () => {
		const confirm = allowSpy();
		const { seed } = await runEdit({
			posture: "direct",
			confirm,
			operations: (current) => [
				{
					operation: "replace_block_text",
					blockId: current.closingId,
					text: "Revenue grew.",
				},
			],
		});
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "edit_document",
				destructive: true,
			}),
		);
		expect(editor!.getBlock(seed.closingId)?.textContent()).toBe(
			"Revenue grew.",
		);
	});

	it("AIB3: a direct edit_document delete of a non-empty block consults confirm", async () => {
		const confirm = vi.fn<AIToolConfirmFn>(() => "refuse");
		const { seed, before } = await runEdit({
			posture: "direct",
			confirm,
			operations: (current) => [
				{ operation: "delete_blocks", blockIds: [current.introId] },
			],
		});
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(editor!.getBlock(seed.introId)).not.toBeNull();
		expect(documentHash(editor!)).toBe(before);
	});

	it("AIB3: a direct edit_document delete of an empty block never consults confirm", async () => {
		const confirm = allowSpy();
		await runEdit({
			posture: "direct",
			confirm,
			operations: () => [
				{ operation: "delete_blocks", blockIds: [EMPTY_BLOCK_ID] },
			],
		});
		expect(confirm).not.toHaveBeenCalled();
		expect(editor!.getBlock(EMPTY_BLOCK_ID)).toBeNull();
	});

	it("AIB3: refuse with no resolver blocks a direct delete and leaves the document hash unchanged", async () => {
		const { seed, before, generation } = await runEdit({
			posture: "direct",
			unconfirmedDestructive: "refuse",
			operations: (current) => [
				{ operation: "delete_blocks", blockIds: [current.introId] },
			],
		});
		expect(documentHash(editor!)).toBe(before);
		expect(editor!.getBlock(seed.introId)).not.toBeNull();
		// A blocked call's answer is recorded on its call step: the model reads
		// it and the host sees it on the generation.
		const refusal = generation.steps.find(
			(step) =>
				step.toolName === "edit_document" && step.output !== undefined,
		);
		expect(refusal?.output).toEqual({
			ok: false,
			status: "blocked",
			reason: "tool-refused",
		});
	});
});
