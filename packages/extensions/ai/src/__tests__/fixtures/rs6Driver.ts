import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { executeEditDocument, toolsExtension } from "@input/pen-tools";
import type { Editor, ModelAdapter, ModelStreamEvent } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { aiExtension, getAIController } from "../../index";
import { deltaStreamExtension } from "../../stream";
import type { GenerationState } from "../../types";
import {
	composePreview,
	projectAccepted,
	type ComposedPreview,
} from "./composePreview";
import { buildToolOperations, isBenchSkip } from "./editChannelBenchDoubles";
import {
	EDIT_CHANNEL_CORPUS,
	seedEditChannelCorpus,
	type EditChannelCorpusPromptId,
	type EditChannelCorpusSeed,
} from "./editChannelCorpus";

/**
 * RS6 driver: streams one corpus prompt's `edit_document` payload through the
 * real controller and records the review decorations on screen as each
 * operation finishes arriving.
 */

export type Rs6Posture = "direct" | "suggestions";

export const RS6_POSTURES: readonly Rs6Posture[] = ["direct", "suggestions"];

/** Characters per `tool-input-delta`, small enough that every key splits. */
const DELTA_SIZE = 12;

const EDIT_TOOL_NAME = "edit_document";

export interface Rs6Frame {
	readonly operationIndex: number;
	/** The preview composed while the frame was on screen. */
	readonly composed: ComposedPreview;
	/** The document under the preview at that moment, read without decorations. */
	readonly documentLines: readonly string[];
}

export interface Rs6Turn {
	readonly editor: Editor;
	readonly seed: EditChannelCorpusSeed;
	readonly operations: readonly unknown[];
	readonly frames: readonly Rs6Frame[];
	readonly generation: GenerationState;
}

/** A model that ends every turn at once. */
export function idleModel(): ModelAdapter {
	return {
		async *stream() {
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

export function createRs6Editor(
	model: ModelAdapter,
	posture: Rs6Posture,
): Editor {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({
				model,
				contentFormat: { blockGeneration: "markdown" },
				mutationPreference: posture,
				editStreaming: "preview",
				allowedMutatingTools: [EDIT_TOOL_NAME],
			}),
		],
	});
}

export function corpusOperations(
	id: EditChannelCorpusPromptId,
	seed: EditChannelCorpusSeed,
): unknown[] {
	const operations = buildToolOperations(id, [], seed);
	if (isBenchSkip(operations)) {
		throw new Error(
			`corpus prompt ${id} has no operations: ${operations.reason}`,
		);
	}
	return operations;
}

/** Operation count per prompt, read from a throwaway seeded editor. */
export async function corpusOperationCount(
	id: EditChannelCorpusPromptId,
): Promise<number> {
	const editor = createRs6Editor(idleModel(), "direct");
	await editor.whenReady();
	const count = corpusOperations(id, seedEditChannelCorpus(editor)).length;
	editor.destroy();
	return count;
}

/**
 * The payload as the model streams it, with the index just past the closing
 * brace of each operation so the stream can pause on every boundary.
 */
function serializePayload(operations: readonly unknown[]): {
	json: string;
	operationEnds: number[];
} {
	let json = '{"operations":[';
	const operationEnds: number[] = [];
	for (const [index, operation] of operations.entries()) {
		if (index > 0) {
			json += ",";
		}
		json += JSON.stringify(operation);
		operationEnds.push(json.length);
	}
	json += "]}";
	return { json, operationEnds };
}

function* streamPayload(
	operations: readonly unknown[],
	onOperationArrived: (operationIndex: number) => void,
): Generator<ModelStreamEvent> {
	const toolCallId = "rs6-edit";
	const { json, operationEnds } = serializePayload(operations);
	yield { type: "tool-input-start", toolCallId, toolName: EDIT_TOOL_NAME };
	let cursor = 0;
	let operationIndex = 0;
	while (cursor < json.length) {
		const boundary = operationEnds[operationIndex] ?? json.length;
		const end = Math.min(cursor + DELTA_SIZE, boundary);
		yield {
			type: "tool-input-delta",
			toolCallId,
			inputTextDelta: json.slice(cursor, end),
		};
		cursor = end;
		// The loop handled the delta before asking for the next event, so the
		// decorations on screen now are the frame for this operation.
		if (cursor === operationEnds[operationIndex]) {
			onOperationArrived(operationIndex);
			operationIndex += 1;
		}
	}
	yield {
		type: "tool-call",
		toolCallId,
		toolName: EDIT_TOOL_NAME,
		input: { operations },
	};
}

/** Runs prompt `id` in `posture` and records one frame per operation. */
export async function runRs6Turn(
	id: EditChannelCorpusPromptId,
	posture: Rs6Posture,
): Promise<Rs6Turn> {
	const frames: Rs6Frame[] = [];
	let operations: unknown[] = [];
	let passes = 0;
	let editor!: Editor;
	const model: ModelAdapter = {
		capabilities: { partialToolInput: true },
		async *stream() {
			passes += 1;
			if (passes === 1) {
				yield* streamPayload(operations, (operationIndex) => {
					// Composed now: decoration offsets only mean something
					// against the document they were built for.
					frames.push({
						operationIndex,
						composed: composePreview(
							editor,
							editor.getDecorations().decorations,
						),
						documentLines: projectAccepted(editor),
					});
				});
			}
			yield { type: "done" } as ModelStreamEvent;
		},
	};
	editor = createRs6Editor(model, posture);
	await editor.whenReady();
	const seed = seedEditChannelCorpus(editor);
	operations = corpusOperations(id, seed);
	const prompt = EDIT_CHANNEL_CORPUS.find((entry) => entry.id === id)!.prompt;
	const generation = await getAIController(editor)!.runPrompt(prompt, {
		target: "document",
	});
	return { editor, seed, operations, frames, generation };
}

/**
 * A newly seeded editor with the first `count` operations applied directly:
 * the accepted side of the property. EC11 makes the plan the same in both
 * postures, so one direct apply stands for both.
 */
export async function applyCorpusPrefix(
	id: EditChannelCorpusPromptId,
	count: number,
): Promise<{ editor: Editor; seed: EditChannelCorpusSeed }> {
	const editor = createRs6Editor(idleModel(), "direct");
	await editor.whenReady();
	const seed = seedEditChannelCorpus(editor);
	const operations = corpusOperations(id, seed).slice(0, count);
	const result = executeEditDocument(editor, { operations });
	if (!result.ok) {
		throw new Error(
			`fresh apply of ${id} operations 0..${count - 1} failed: ${JSON.stringify(result.rejected)}`,
		);
	}
	return { editor, seed };
}
