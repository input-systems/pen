import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createHeadlessEditor } from "@input/pen-core";
import { directTransport } from "../directTransport";
import type {
	PenStreamPart,
	PenStreamRequest,
	ToolRuntime,
} from "@input/pen-types";

type ToolExecutionContext = Parameters<ToolRuntime["executeTool"]>[2];

function createMockToolRuntime(
	handler: (
		name: string,
		input: unknown,
		ctx: ToolExecutionContext,
	) => Promise<unknown> | AsyncIterable<unknown>,
): ToolRuntime {
	return {
		registerTool: vi.fn(),
		unregisterTool: vi.fn(),
		listTools: () => [],
		getTool: () => null,
		executeTool: handler,
	};
}

function makeRequest(
	overrides: Partial<PenStreamRequest> = {},
): PenStreamRequest {
	return {
		prompt: "test",
		toolCalls: [
			{ toolCallId: "tc-1", name: "read_document", input: { a: 1 } },
		],
		...overrides,
	};
}

async function collectParts(
	iterable: AsyncIterable<PenStreamPart>,
): Promise<PenStreamPart[]> {
	const parts: PenStreamPart[] = [];
	for await (const part of iterable) {
		parts.push(part);
	}
	return parts;
}

describe("@input/pen-transport ./direct", () => {
	it("returns a PenTransport with connected === true (AC 1)", () => {
		const toolRuntime = createMockToolRuntime(async () => "ok");
		const transport = directTransport({ toolRuntime });

		expect(transport.connected).toBe(true);
	});

	it("yields tool-output + done from a Promise-returning tool (AC 2)", async () => {
		const toolRuntime = createMockToolRuntime(async () => ({
			result: "hello",
		}));
		const transport = directTransport({ toolRuntime });

		const parts = await collectParts(transport.stream(makeRequest()));

		expect(parts).toHaveLength(2);
		expect(parts[0]).toMatchObject({
			type: "tool-output",
			toolCallId: "tc-1",
			output: { result: "hello" },
		});
		expect(parts[1]).toMatchObject({ type: "done" });
	});

	it("forwards each part from an AsyncIterable-returning tool (AC 3)", async () => {
		async function* streamingTool(): AsyncIterable<PenStreamPart> {
			yield { type: "gen-start", zoneId: "z1", blockId: "b1" };
			yield { type: "gen-delta", zoneId: "z1", delta: "hello " };
			yield { type: "gen-delta", zoneId: "z1", delta: "world" };
			yield {
				type: "gen-end",
				zoneId: "z1",
				status: "complete",
			};
		}

		const toolRuntime = createMockToolRuntime(() => streamingTool());
		const transport = directTransport({ toolRuntime });

		const parts = await collectParts(transport.stream(makeRequest()));

		expect(parts[0]).toMatchObject({
			type: "gen-start",
			zoneId: "z1",
		});
		expect(parts[1]).toMatchObject({
			type: "gen-delta",
			delta: "hello ",
		});
		expect(parts[2]).toMatchObject({
			type: "gen-delta",
			delta: "world",
		});
		expect(parts[3]).toMatchObject({
			type: "gen-end",
			status: "complete",
		});
		expect(parts[4]).toMatchObject({ type: "done" });
	});

	it("disconnect() aborts active streams (AC 4)", async () => {
		let releaseSecond: () => void = () => {};
		const secondGate = new Promise<void>((resolve) => {
			releaseSecond = resolve;
		});
		let sawFirst: () => void = () => {};
		const firstSeen = new Promise<void>((resolve) => {
			sawFirst = resolve;
		});

		async function* gatedTool(): AsyncIterable<PenStreamPart> {
			yield { type: "gen-delta", zoneId: "z1", delta: "first" };
			await secondGate;
			yield { type: "gen-delta", zoneId: "z1", delta: "second" };
		}

		const toolRuntime = createMockToolRuntime(() => gatedTool());
		const transport = directTransport({ toolRuntime });

		const parts: PenStreamPart[] = [];
		const consume = (async () => {
			for await (const part of transport.stream(makeRequest())) {
				parts.push(part);
				if (part.type === "gen-delta" && part.delta === "first") {
					sawFirst();
				}
			}
		})();

		await firstSeen;
		await transport.disconnect();
		releaseSecond();
		await consume;

		expect(parts.filter((part) => part.type === "gen-delta")).toEqual([
			{ type: "gen-delta", zoneId: "z1", delta: "first" },
		]);
		expect(parts.at(-1)).toMatchObject({
			type: "abort",
			reason: "disconnected",
		});
	});

	it("tool execution error yields error part, not thrown (AC 5)", async () => {
		const onError = vi.fn();
		const toolRuntime = createMockToolRuntime(async () => {
			throw new Error("tool failed");
		});
		const transport = directTransport({ toolRuntime, onError });

		const parts = await collectParts(transport.stream(makeRequest()));

		expect(parts).toHaveLength(1);
		expect(parts[0]).toMatchObject({
			type: "error",
			errorText: "tool failed",
		});
		expect(onError).toHaveBeenCalledOnce();
	});

	it("onConnectionChange() never fires (AC 6)", async () => {
		const toolRuntime = createMockToolRuntime(async () => "ok");
		const transport = directTransport({ toolRuntime });

		const callback = vi.fn();
		const unsub = transport.onConnectionChange(callback);

		await transport.connect();
		await transport.disconnect();

		expect(callback).not.toHaveBeenCalled();
		unsub();
	});

	it("COL6 has no reconnect surface and a later stream() is a new in-process run", async () => {
		const toolRuntime = createMockToolRuntime(async () => ({
			result: "ok",
		}));
		const transport = directTransport({ toolRuntime });

		expect(transport.reconnect).toBeUndefined();
		expect(transport.connected).toBe(true);

		const first = await collectParts(transport.stream(makeRequest()));
		await transport.disconnect();
		expect(transport.connected).toBe(true);

		const second = await collectParts(transport.stream(makeRequest()));
		expect(first.at(-1)).toMatchObject({ type: "done" });
		expect(second.at(-1)).toMatchObject({ type: "done" });
		expect(second).toHaveLength(2);
	});

	it("COL6 README states in-process tests and demos do not ship", () => {
		const readme = readFileSync(
			join(import.meta.dirname, "../../../README.md"),
			"utf8",
		);
		expect(readme).toMatch(/in-process/);
		expect(readme).toMatch(/tests and demos/);
		expect(readme).toMatch(/Do not ship it/);
	});

	it("AIB2 well-formed request without editor still executes tools", async () => {
		const executeTool = vi.fn(async () => ({ result: "ok" }));
		const toolRuntime = createMockToolRuntime(executeTool);
		const transport = directTransport({ toolRuntime });

		const parts = await collectParts(
			transport.stream(
				makeRequest({ context: { docId: "doc-1", blockId: "b1" } }),
			),
		);

		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(parts.filter((p) => p.type === "error")).toHaveLength(0);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toMatchObject({
			type: "tool-output",
			toolCallId: "tc-1",
			output: { result: "ok" },
		});
		expect(parts[1]).toMatchObject({ type: "done" });
	});

	it("AIB4: every tool write of one request shares one undo group, and the next request gets its own", async () => {
		const editor = createHeadlessEditor();
		const apply = vi.spyOn(editor, "apply");
		const seedId = "b1";
		const toolRuntime = createMockToolRuntime(async (_name, _input, ctx) => {
			ctx.editor.apply(
				[{ type: "splice-text", blockId: seedId, from: 0, to: 0, insert: "x" }],
				{ origin: "ai" },
			);
			return { applied: true };
		});
		const transport = directTransport({
			toolRuntime,
			editor,
			allowedMutatingTools: ["insert_block"],
		});
		const twoCalls = makeRequest({
			toolCalls: [
				{ toolCallId: "tc-1", name: "insert_block", input: {} },
				{ toolCallId: "tc-2", name: "insert_block", input: {} },
			],
		});

		await collectParts(transport.stream(twoCalls));
		await collectParts(transport.stream(twoCalls));

		const groups = apply.mock.calls.map(
			(call) => (call[1] as { undoGroupId?: string } | undefined)?.undoGroupId,
		);
		expect(groups).toHaveLength(4);
		expect(groups[0]).toEqual(expect.any(String));
		expect(groups[1]).toBe(groups[0]);
		expect(groups[2]).toEqual(expect.any(String));
		expect(groups[3]).toBe(groups[2]);
		expect(groups[2]).not.toBe(groups[0]);
	});

	it("AIB2 tools receive the construction-time editor and can apply", async () => {
		const editor = createHeadlessEditor();
		const apply = vi.spyOn(editor, "apply");
		const seedId = editor.firstBlock()?.id ?? "b1";

		const toolRuntime = createMockToolRuntime(
			async (_name, _input, ctx) => {
				// The call's own view of the construction-time editor (AIB3).
				expect(ctx.editor.internals.adapter).toBe(editor.internals.adapter);
				ctx.editor.apply(
					[
						{
							type: "splice-text",
							blockId: seedId,
							from: 0,
				to: 0,
				insert: "granted",
						},
					],
					{ origin: "ai" },
				);
				return { applied: true };
			},
		);
		const transport = directTransport({
			toolRuntime,
			editor,
			allowedMutatingTools: ["insert_block"],
		});

		const parts = await collectParts(
			transport.stream(
				makeRequest({
					toolCalls: [
						{ toolCallId: "tc-1", name: "insert_block", input: {} },
					],
				}),
			),
		);

		expect(parts.filter((p) => p.type === "error")).toHaveLength(0);
		expect(parts.filter((p) => p.type === "tool-output")).toHaveLength(1);
		expect(apply).toHaveBeenCalled();
		// AIB4: the request's tool writes carry its one undo group.
		const options = apply.mock.calls[0]?.[1] as {
			origin: { type: string; groupId: string };
			groupId: string;
			undoGroupId: string;
		};
		expect(options.origin).toEqual({ type: "ai", groupId: expect.any(String) });
		expect(options.undoGroupId).toBe(options.origin.groupId);
		expect(options.groupId).toBe(options.origin.groupId);
	});
});
