import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHeadlessEditor } from "@input/pen-core";
import { parseSSELine } from "../parser";
import { createSSEHandler } from "../server";
import { sseTransport } from "../client";
import type { PenStreamPart, PenStreamRequest } from "@input/pen-types";
import type { SSEEvent } from "../types";

type FetchCall = [input: string | URL | globalThis.Request, init?: RequestInit];

function makeRequest(
	overrides: Partial<PenStreamRequest> = {},
): PenStreamRequest {
	return {
		prompt: "test",
		toolCalls: [
			{ toolCallId: "tc-1", name: "read_document", input: { msg: "hi" } },
		],
		...overrides,
	};
}

async function readAllSSEEvents(response: Response): Promise<SSEEvent[]> {
	const events: SSEEvent[] = [];
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let pending: Partial<SSEEvent> = {};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const result = parseSSELine(line, pending);
			pending = result.pending;
			if (result.event) events.push(result.event);
		}
	}

	if (buffer.length > 0) {
		const result = parseSSELine(buffer, pending);
		if (result.event) events.push(result.event);
	}

	return events;
}

async function collectParts(
	iter: AsyncIterable<PenStreamPart>,
): Promise<PenStreamPart[]> {
	const parts: PenStreamPart[] = [];
	for await (const part of iter) {
		parts.push(part);
	}
	return parts;
}

describe("SSE parser", () => {
	it("parses basic data event", () => {
		let pending: Partial<SSEEvent> = {};

		const r1 = parseSSELine('data: {"type":"done"}', pending);
		pending = r1.pending;
		expect(r1.event).toBeNull();

		const r2 = parseSSELine("", pending);
		expect(r2.event).toEqual({ data: '{"type":"done"}' });
	});

	it("handles multi-line data", () => {
		let pending: Partial<SSEEvent> = {};

		pending = parseSSELine("data: line1", pending).pending;
		pending = parseSSELine("data: line2", pending).pending;
		const result = parseSSELine("", pending);

		expect(result.event?.data).toBe("line1\nline2");
	});

	it("ignores comment lines", () => {
		let pending: Partial<SSEEvent> = {};
		const result = parseSSELine(": keepalive", pending);
		expect(result.event).toBeNull();
		expect(result.pending).toBe(pending);
	});

	it("parses id and event fields", () => {
		let pending: Partial<SSEEvent> = {};
		pending = parseSSELine("id: abc-123:0", pending).pending;
		pending = parseSSELine("event: message", pending).pending;
		pending = parseSSELine('data: {"type":"ping"}', pending).pending;
		const result = parseSSELine("", pending);

		expect(result.event).toEqual({
			id: "abc-123:0",
			event: "message",
			data: '{"type":"ping"}',
		});
	});

	it("parses retry field as integer", () => {
		let pending: Partial<SSEEvent> = {};
		pending = parseSSELine("retry: 3000", pending).pending;
		pending = parseSSELine('data: {"type":"done"}', pending).pending;
		const result = parseSSELine("", pending);

		expect(result.event?.retry).toBe(3000);
	});
});

describe("SSE server handler", () => {
	it("returns text/event-stream content type (AC 16)", async () => {
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() {},
				unregisterTool() {},
				listTools: () => [],
				getTool: () => null,
				executeTool: async () => "result",
			},
			pingInterval: 60_000,
		});

		const request = new Request("http://localhost/sse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeRequest()),
		});

		const response = await handler(request);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(response.headers.get("X-Stream-Id")).toBeTruthy();

		await response.body?.cancel();
	});

	it("event IDs use monotonic streamId:eventIndex format (AC 8)", async () => {
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() {},
				unregisterTool() {},
				listTools: () => [],
				getTool: () => null,
				executeTool: async () => "result",
			},
			pingInterval: 60_000,
		});

		const request = new Request("http://localhost/sse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeRequest()),
		});

		const response = await handler(request);
		const streamId = response.headers.get("X-Stream-Id")!;
		const events = await readAllSSEEvents(response);

		for (let i = 0; i < events.length; i++) {
			expect(events[i].id).toBe(`${streamId}:${i}`);
		}
	});

	it("yields tool-output and done parts for Promise-based tools (AC 7)", async () => {
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() {},
				unregisterTool() {},
				listTools: () => [],
				getTool: () => null,
				executeTool: async () => ({ msg: "ok" }),
			},
			pingInterval: 60_000,
		});

		const request = new Request("http://localhost/sse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeRequest()),
		});

		const response = await handler(request);
		const events = await readAllSSEEvents(response);

		const parts = events.map((e) => JSON.parse(e.data) as PenStreamPart);

		const toolOutput = parts.find((p) => p.type === "tool-output");
		expect(toolOutput).toMatchObject({
			type: "tool-output",
			toolCallId: "tc-1",
			output: { msg: "ok" },
		});

		const done = parts.find((p) => p.type === "done");
		expect(done).toMatchObject({ type: "done" });
	});

	it("COL6 GET is not a resume surface and README states single-process non-resumable development-oriented", async () => {
		const handler = createSSEHandler({ pingInterval: 60_000 });

		const missingId = await handler(
			new Request("http://localhost/sse", { method: "GET" }),
		);
		const withId = await handler(
			new Request("http://localhost/sse", {
				method: "GET",
				headers: { "Last-Event-ID": "some-stream:5" },
			}),
		);

		expect(missingId.status).toBe(405);
		expect(withId.status).toBe(405);
		expect(withId.status).not.toBe(501);
		expect(withId.headers.get("X-Replay-Supported")).toBeNull();

		const transport = sseTransport({ url: "http://test/sse" });
		expect(transport.reconnect).toBeUndefined();

		const readme = readFileSync(
			join(import.meta.dirname, "../../../README.md"),
			"utf8",
		);
		expect(readme).toMatch(/single-process/);
		expect(readme).toMatch(/non-resumable/);
		expect(readme).toMatch(/development-oriented/);
	});

	it("COL6 malformed POST body returns 400 and does not throw", async () => {
		const handler = createSSEHandler({ pingInterval: 60_000 });

		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{not-json",
			}),
		);

		expect(response.status).toBe(400);
	});

	it("AIB2 hostile context.editor body is 400 and executeTool never runs", async () => {
		const executeTool = vi.fn(async () => "should-not-run");
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() {},
				unregisterTool() {},
				listTools: () => [],
				getTool: () => null,
				executeTool,
			},
			pingInterval: 60_000,
		});

		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: "x",
					context: { editor: { apply: 1, internals: 1 } },
					toolCalls: [
						{ toolCallId: "tc-1", name: "echo", input: {} },
					],
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(executeTool).not.toHaveBeenCalled();
		expect(response.headers.get("Content-Type")).not.toBe(
			"text/event-stream",
		);
	});

	it("AIB2 well-formed request without editor still executes tools", async () => {
		const executeTool = vi.fn(async () => ({ msg: "ok" }));
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() {},
				unregisterTool() {},
				listTools: () => [],
				getTool: () => null,
				executeTool,
			},
			pingInterval: 60_000,
		});

		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(
					makeRequest({
						context: { docId: "doc-1", blockId: "b1" },
					}),
				),
			}),
		);

		expect(response.status).toBe(200);
		const events = await readAllSSEEvents(response);
		const parts = events.map((e) => JSON.parse(e.data) as PenStreamPart);
		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(parts.filter((p) => p.type === "error")).toHaveLength(0);
		expect(parts.filter((p) => p.type === "tool-output")).toHaveLength(1);
		expect(parts.filter((p) => p.type === "done")).toHaveLength(1);
	});

	it("rejects a non-string context.docId with 400 before executeTool", async () => {
		const executeTool = vi.fn(async () => "should-not-run");
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() {},
				unregisterTool() {},
				listTools: () => [],
				getTool: () => null,
				executeTool,
			},
			pingInterval: 60_000,
		});

		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: "x",
					context: { docId: { nested: true } },
					toolCalls: [
						{ toolCallId: "tc-1", name: "echo", input: {} },
					],
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(executeTool).not.toHaveBeenCalled();
	});

	it("rejects a non-array toolCalls with 400 before executeTool", async () => {
		const executeTool = vi.fn(async () => "should-not-run");
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() {},
				unregisterTool() {},
				listTools: () => [],
				getTool: () => null,
				executeTool,
			},
			pingInterval: 60_000,
		});

		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: "x",
					toolCalls: { name: "echo" },
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(executeTool).not.toHaveBeenCalled();
	});

	it("AIB2 tools receive the construction-time editor, not a wire value", async () => {
		const editor = createHeadlessEditor();
		const apply = vi.spyOn(editor, "apply");
		const seedId = editor.firstBlock()?.id ?? "b1";

		const handler = createSSEHandler({
			editor,
			allowedMutatingTools: ["insert_block"],
			toolRuntime: {
				registerTool() {},
				unregisterTool() {},
				listTools: () => [],
				getTool: () => null,
				executeTool: async (_name, _input, ctx) => {
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
			},
			pingInterval: 60_000,
		});

		const response = await handler(
			new Request("http://localhost/sse", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(
					makeRequest({
						context: { docId: "doc-1", blockId: "b1" },
						toolCalls: [
							{
								toolCallId: "tc-1",
								name: "insert_block",
								input: {},
							},
						],
					}),
				),
			}),
		);

		expect(response.status).toBe(200);
		const events = await readAllSSEEvents(response);
		const parts = events.map((e) => JSON.parse(e.data) as PenStreamPart);
		expect(parts.filter((p) => p.type === "error")).toHaveLength(0);
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

describe("SSE client transport", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	function sseBody(
		events: Array<{ id?: string; data: string }>,
	): ReadableStream<Uint8Array> {
		const encoder = new TextEncoder();
		return new ReadableStream({
			start(controller) {
				for (const evt of events) {
					let chunk = "";
					if (evt.id) chunk += `id: ${evt.id}\n`;
					chunk += `data: ${evt.data}\n\n`;
					controller.enqueue(encoder.encode(chunk));
				}
				controller.close();
			},
		});
	}

	it("ping parts from server are consumed but NOT yielded to consumer (AC 9)", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					sseBody([
						{ id: "s:0", data: '{"type":"ping"}' },
						{
							id: "s:1",
							data: '{"type":"tool-output","toolCallId":"tc-1","output":"ok"}',
						},
						{ id: "s:2", data: '{"type":"ping"}' },
						{ id: "s:3", data: '{"type":"done"}' },
					]),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
		);

		const transport = sseTransport({
			url: "http://test/sse",
			pingTimeout: 30_000,
		});
		const parts = await collectParts(transport.stream(makeRequest()));

		expect(parts.every((p) => p.type !== "ping")).toBe(true);
		expect(parts).toHaveLength(2);
		expect(parts[0].type).toBe("tool-output");
		expect(parts[1].type).toBe("done");
	});

	it("client connected → false when pingTimeout elapses without events (AC 10)", async () => {
		const encoder = new TextEncoder();
		let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

		globalThis.fetch = vi.fn(async () => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					ctrl = controller;
					controller.enqueue(
						encoder.encode(
							'data: {"type":"tool-output","toolCallId":"tc-1","output":"x"}\n\n',
						),
					);
				},
			});
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		});

		const transport = sseTransport({
			url: "http://test/sse",
			pingTimeout: 50,
		});
		const connectionChanges: boolean[] = [];
		transport.onConnectionChange((v) => connectionChanges.push(v));

		const parts: PenStreamPart[] = [];
		const stream = transport.stream(makeRequest());
		const streamIter = stream[Symbol.asyncIterator]();

		const first = await streamIter.next();
		parts.push(first.value!);

		expect(transport.connected).toBe(true);

		await new Promise((r) => setTimeout(r, 80));

		expect(transport.connected).toBe(false);
		expect(connectionChanges).toContain(false);

		if (ctrl) {
			ctrl.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
		}
		await transport.disconnect();
	});

	it("disconnect() aborts active fetch and sets connected = false (AC 11)", async () => {
		const encoder = new TextEncoder();

		globalThis.fetch = vi.fn(async () => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						encoder.encode(
							'data: {"type":"tool-output","toolCallId":"tc-1","output":"hi"}\n\n',
						),
					);
				},
			});
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		});

		const transport = sseTransport({ url: "http://test/sse" });
		const parts: PenStreamPart[] = [];

		const consumePromise = (async () => {
			try {
				for await (const part of transport.stream(makeRequest())) {
					parts.push(part);
					if (parts.length === 1) {
						await transport.disconnect();
						break;
					}
				}
			} catch {
				// Abort may cause iterator to throw
			}
		})();

		await consumePromise;

		expect(transport.connected).toBe(false);
		expect(parts).toHaveLength(1);
	});

	it("onConnectionChange() fires on state transitions (AC 12)", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					sseBody([{ id: "s:0", data: '{"type":"done"}' }]),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
		);

		const transport = sseTransport({ url: "http://test/sse" });
		const changes: boolean[] = [];
		transport.onConnectionChange((v) => changes.push(v));

		expect(transport.connected).toBe(false);

		await collectParts(transport.stream(makeRequest()));

		expect(changes[0]).toBe(true);
	});

	it("connect() makes HEAD request and sets connected based on response (AC 13)", async () => {
		globalThis.fetch = vi.fn(
			async (
				url: string | URL | globalThis.Request,
				init?: RequestInit,
			) => {
				const req = init ?? {};
				if (req.method === "HEAD") {
					return new Response(null, { status: 200 });
				}
				return new Response(null, { status: 404 });
			},
		);

		const transport = sseTransport({ url: "http://test/sse" });
		expect(transport.connected).toBe(false);

		await transport.connect();
		expect(transport.connected).toBe(true);

		const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
			.calls as FetchCall[];
		const headCall = fetchCalls.find((c) => c[1]?.method === "HEAD");
		expect(headCall).toBeDefined();
	});

	it("COL6 stream() does not send Last-Event-ID", async () => {
		const fetchSpy = vi.fn(
			async () =>
				new Response(
					sseBody([{ id: "s:0", data: '{"type":"done"}' }]),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
		);
		globalThis.fetch = fetchSpy;

		const transport = sseTransport({ url: "http://test/sse" });
		await collectParts(transport.stream(makeRequest()));

		expect(transport.reconnect).toBeUndefined();
		const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
			.calls as FetchCall[];
		const postCall = fetchCalls[0];
		const sentHeaders = postCall[1]?.headers as Record<string, string>;
		expect(sentHeaders["Last-Event-ID"]).toBeUndefined();
		expect(postCall[1]?.method).toBe("POST");
	});

	it("COL6 reconnect past retention is a full restart, not a resume", async () => {
		const fetchSpy = vi.fn(
			async () =>
				new Response(
					sseBody([
						{ id: "expired-stream:999", data: '{"type":"done"}' },
					]),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
		);
		globalThis.fetch = fetchSpy;

		const handler = createSSEHandler({ pingInterval: 60_000 });
		const pastRetention = await handler(
			new Request("http://localhost/sse", {
				method: "GET",
				headers: { "Last-Event-ID": "expired-stream:999" },
			}),
		);
		expect(pastRetention.status).toBe(405);
		expect(pastRetention.status).not.toBe(200);
		expect(pastRetention.status).not.toBe(501);
		expect(pastRetention.headers.get("X-Replay-Supported")).toBeNull();

		const transport = sseTransport({ url: "http://test/sse" });
		expect(transport.reconnect).toBeUndefined();
		await collectParts(transport.stream(makeRequest()));
		await transport.disconnect();
		const parts = await collectParts(transport.stream(makeRequest()));
		expect(parts).toEqual([{ type: "done" }]);

		const fetchCalls = (fetchSpy as ReturnType<typeof vi.fn>).mock
			.calls as FetchCall[];
		expect(fetchCalls).toHaveLength(2);
		for (const call of fetchCalls) {
			expect(call[1]?.method).toBe("POST");
			const sentHeaders = call[1]?.headers as Record<string, string>;
			expect(sentHeaders["Last-Event-ID"]).toBeUndefined();
		}

		const readme = readFileSync(
			join(import.meta.dirname, "../../../README.md"),
			"utf8",
		);
		expect(readme).toMatch(/no replayable log/);
		expect(readme).toMatch(/no retention bound/);
		expect(readme).toMatch(/full restart/);
	});

	it("COL6 disconnect then stream() is a full restart, not a resume", async () => {
		const fetchSpy = vi.fn(
			async () =>
				new Response(
					sseBody([{ id: "s:0", data: '{"type":"done"}' }]),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
		);
		globalThis.fetch = fetchSpy;

		const transport = sseTransport({ url: "http://test/sse" });
		await collectParts(transport.stream(makeRequest()));
		await transport.disconnect();
		expect(transport.connected).toBe(false);
		expect(transport.reconnect).toBeUndefined();

		const parts = await collectParts(transport.stream(makeRequest()));
		expect(parts).toEqual([{ type: "done" }]);

		const fetchCalls = (fetchSpy as ReturnType<typeof vi.fn>).mock
			.calls as FetchCall[];
		expect(fetchCalls).toHaveLength(2);
		for (const call of fetchCalls) {
			expect(call[1]?.method).toBe("POST");
			const sentHeaders = call[1]?.headers as Record<string, string>;
			expect(sentHeaders["Last-Event-ID"]).toBeUndefined();
		}
	});

	it("COL6 yields parts in arrival order and does not dedupe event ids", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					sseBody([
						{
							id: "s:2",
							data: '{"type":"tool-output","toolCallId":"tc-1","output":"second"}',
						},
						{
							id: "s:2",
							data: '{"type":"tool-output","toolCallId":"tc-1","output":"duplicate"}',
						},
						{
							id: "s:1",
							data: '{"type":"tool-output","toolCallId":"tc-1","output":"first"}',
						},
						{ id: "s:3", data: '{"type":"done"}' },
					]),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
		);

		const transport = sseTransport({ url: "http://test/sse" });
		const parts = await collectParts(transport.stream(makeRequest()));

		expect(parts).toEqual([
			{ type: "tool-output", toolCallId: "tc-1", output: "second" },
			{ type: "tool-output", toolCallId: "tc-1", output: "duplicate" },
			{ type: "tool-output", toolCallId: "tc-1", output: "first" },
			{ type: "done" },
		]);
	});

	it("COL6 malformed and oversized frames are dropped with an error part and do not throw", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					sseBody([
						{
							id: "s:0",
							data: '{"type":"tool-output","toolCallId":"tc-1","output":"ok"}',
						},
						{ id: "s:1", data: "not-json{" },
						{ id: "s:2", data: "x".repeat(1_048_576 + 64) },
						{ id: "s:3", data: '{"type":"done"}' },
					]),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
		);

		const transport = sseTransport({ url: "http://test/sse" });
		const parts = await collectParts(transport.stream(makeRequest()));

		expect(parts[0]).toMatchObject({
			type: "tool-output",
			toolCallId: "tc-1",
			output: "ok",
		});
		expect(parts[1]).toMatchObject({
			type: "error",
			code: "MALFORMED_EVENT",
		});
		expect(parts[2]).toMatchObject({
			type: "error",
			code: "OVERSIZED_EVENT",
		});
		expect(parts[3]).toMatchObject({ type: "done" });
	});
});
