import type {
	ApplyOptions,
	DocumentOp,
	Editor,
	PenStreamPart,
} from "@input/pen-types";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { processStream } from "../processStream";

function createReadOnlyTargetEditor(): Editor {
	const block = {
		id: "subdocument-1",
		type: "subdocument",
	};

	return {
		documentProfile: "structured",
		schema: {
			resolve(blockType: string) {
				if (blockType !== "subdocument") {
					return null;
				}
				return {
					type: "subdocument",
					content: "subdocument",
					display: {
						hidden: true,
					},
				};
			},
		},
		getBlock: (blockId: string) => (blockId === block.id ? block : null),
		apply: vi.fn<(ops: DocumentOp[], options?: ApplyOptions) => void>(),
		facet: (facet: { name: string }) =>
			facet.name === "deltaStream.target"
				? {
						generationZone: null,
						beginStreaming: vi.fn(),
						appendDelta: vi.fn(),
						endStreaming: vi.fn(),
					}
				: null,
		internals: {
			emit: vi.fn(),
		},
	} as unknown as Editor;
}

function createToolRuntimeEditor(): {
	editor: Editor;
	onPart: Mock<(part: PenStreamPart) => void>;
} {
	const streamingTarget = {
		generationZone: null,
		beginStreaming: vi.fn(),
		appendDelta: vi.fn(),
		endStreaming: vi.fn(),
	};
	const runtime = {
		executeTool: vi.fn(async function* () {
			yield { chunk: "one" };
			yield { chunk: "two" };
		}),
	};
	const onPart = vi.fn<(part: PenStreamPart) => void>();

	return {
		editor: {
			documentProfile: "structured",
			schema: {
				resolve: () => null,
			},
			apply: vi.fn<(ops: DocumentOp[], options?: ApplyOptions) => void>(),
			facet: (facet: { name: string }) => {
				if (facet.name === "deltaStream.target") {
					return streamingTarget;
				}
				if (facet.name === "tools.toolRuntime") {
					return runtime;
				}
				return null;
			},
			internals: {
				emit: vi.fn(),
			},
		} as unknown as Editor,
		onPart,
	};
}

async function* createStream(
	parts: PenStreamPart[],
): AsyncIterable<PenStreamPart> {
	for (const part of parts) {
		yield part;
	}
}

describe("@input/pen-ai/stream processStream", () => {
	it("rejects streamed block mutations against read-only targets", async () => {
		const editor = createReadOnlyTargetEditor();

		await expect(
			processStream(
				createStream([
					{
						type: "block-update",
						blockId: "subdocument-1",
						props: { title: "Forbidden" },
					},
				]),
				editor,
			),
		).resolves.toBeUndefined();

		expect(editor.apply).not.toHaveBeenCalled();
		expect(editor.internals.emit).toHaveBeenCalledWith(
			"diagnostic",
			expect.objectContaining({
				code: "stream-part-malformed",
				source: "delta-stream",
			}),
		);
	});

	it("emits progressive tool-output updates for async tool results", async () => {
		const { editor, onPart } = createToolRuntimeEditor();

		await processStream(
			createStream([
				{
					type: "tool-input-available",
					toolCallId: "tool-1",
					toolName: "search_document",
					input: {},
				},
			]),
			editor,
			{ onPart },
		);

		expect(onPart).toHaveBeenCalledWith({
			type: "tool-output",
			toolCallId: "tool-1",
			output: { chunk: "one" },
		});
		expect(onPart).toHaveBeenCalledWith({
			type: "tool-output",
			toolCallId: "tool-1",
			output: [{ chunk: "one" }, { chunk: "two" }],
		});
	});
});
