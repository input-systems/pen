import { describe, expect, it, vi } from "vitest";
import type {
	ApplyOptions,
	DocumentOp,
	Editor,
	ToolDefinition,
} from "@input/pen-types";
import { createModelDouble } from "@input/pen-test";
import {
	AI_TOOL_MAX_CALLS_PER_TURN,
	AI_TOOL_MAX_OPS_PER_CALL,
	AI_TOOL_MAX_TOTAL_OPS_PER_TURN,
	AI_TOOL_UNCONFIRMED_CODE,
	AIToolContextImpl,
	AIToolRuntimeImpl,
	authorizeAIToolCall,
	createAIToolTurn,
	executeAITool,
	openAIToolCall,
	isAIToolCallDenied,
	isDestructiveAITool,
	isMutatingAITool,
	listAITools,
} from "../index";
import type { AIToolTurnOptions } from "../authority";

function insertOp(blockId: string): DocumentOp {
	return {
		type: "insert-block",
		blockId,
		blockType: "paragraph",
		props: {},
		position: "last",
	};
}

function createRecordingEditor() {
	const applied: DocumentOp[] = [];
	const diagnostics: Array<{ code: string; message: string }> = [];
	const editor = {
		apply(ops: DocumentOp[]) {
			applied.push(...ops);
		},
		facet: () => null,
		internals: {
			emit(
				_event: string,
				diagnostic: { code: string; message: string },
			) {
				diagnostics.push(diagnostic);
			},
		},
	} as unknown as Editor;
	return { editor, applied, diagnostics };
}

function mutatingTool(name: string, opCount = 1): ToolDefinition {
	return {
		name,
		description: `${name} mutates the document`,
		inputSchema: { type: "object", properties: {} },
		handler: async (_input, context) => {
			context.editor.apply(
				Array.from({ length: opCount }, (_, index) =>
					insertOp(`${name}-${index}`),
				),
			);
			return { ok: true, name };
		},
	};
}

/** Runs one call of `tool` in a fresh turn that allowlists it. */
async function runOneCall(
	tool: ToolDefinition,
	options: Omit<AIToolTurnOptions, "allowedMutatingTools"> = {},
) {
	const runtime = new AIToolRuntimeImpl();
	runtime.registerTool(tool);
	const { editor, applied, diagnostics } = createRecordingEditor();
	const context = new AIToolContextImpl(editor, "doc-1", () => {});
	const turn = createAIToolTurn({
		allowedMutatingTools: [tool.name],
		...options,
	});
	const result = await executeAITool(runtime, tool.name, {}, context, turn);
	return { result, applied, diagnostics, turn };
}

describe("AIB3 tool authority", () => {
	it("classifies tools names and defaults unknown tools to mutating", () => {
		expect(isMutatingAITool("read_document")).toBe(false);
		expect(isMutatingAITool("insert_block")).toBe(true);
		expect(isDestructiveAITool("delete_block")).toBe(true);
		expect(isDestructiveAITool("insert_block")).toBe(false);
		expect(isMutatingAITool("host_rewrite")).toBe(true);
	});

	it("AIB3: authorizeAIToolCall default-denies mutating tools", async () => {
		const denied = await authorizeAIToolCall("insert_block", {}, null, {
			allowedMutatingTools: [],
		});
		expect(denied).toEqual({
			allowed: false,
			mutating: true,
			destructive: false,
			reason: "tool-not-allowed",
		});

		const allowed = await authorizeAIToolCall("insert_block", {}, null, {
			allowedMutatingTools: ["insert_block"],
		});
		expect(allowed.allowed).toBe(true);
	});

	it("AIB3: openAIToolCall denies an un-allowlisted mutating tool before executeTool", async () => {
		const runtime = new AIToolRuntimeImpl();
		const execute = vi.fn(async () => {
			throw new Error("handler must not run");
		});
		runtime.registerTool({
			name: "insert_block",
			description: "Insert",
			inputSchema: { type: "object", properties: {} },
			handler: execute,
		});
		const { editor, applied } = createRecordingEditor();
		const context = new AIToolContextImpl(editor, "doc-1", () => {});
		const turn = createAIToolTurn({ allowedMutatingTools: [] });

		const opened = await openAIToolCall(
			runtime,
			"insert_block",
			{},
			context,
			turn,
		);

		expect(opened.ok).toBe(false);
		if (!opened.ok) {
			expect(opened.denial).toEqual({
				ok: false,
				status: "blocked",
				reason: "tool-not-allowed",
			});
		}
		expect(execute).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
	});

	it("AIB3: executeAITool without a turn default-denies mutating and destructive tools, including calls a resolver classifies destructive", async () => {
		const runtime = new AIToolRuntimeImpl();
		runtime.registerTool(mutatingTool("insert_block"));
		runtime.registerTool(mutatingTool("delete_block"));
		runtime.registerTool({
			name: "read_document",
			description: "Read",
			inputSchema: { type: "object", properties: {} },
			handler: async () => ({ ok: true, name: "read_document" }),
		});
		runtime.registerTool({
			name: "host_wipe",
			description: "Declared destructive without mutating",
			inputSchema: { type: "object", properties: {} },
			mutating: false,
			destructive: true,
			handler: async (_input, context) => {
				context.editor.apply([insertOp("host_wipe-0")]);
				return { ok: true, name: "host_wipe" };
			},
		});
		runtime.registerTool({
			name: "host_classified",
			description: "Classifies each call; this one is destructive",
			inputSchema: { type: "object", properties: {} },
			mutating: false,
			destructive: () => true,
			handler: async (_input, context) => {
				context.editor.apply([insertOp("host_classified-0")]);
				return { ok: true, name: "host_classified" };
			},
		});
		const { editor, applied } = createRecordingEditor();
		const context = new AIToolContextImpl(editor, "doc-1", () => {});

		const execute = (name: string) =>
			executeAITool(runtime, name, {}, context);

		for (const name of [
			"host_classified",
			"insert_block",
			"delete_block",
			"host_wipe",
		]) {
			expect(await execute(name), name).toEqual({
				ok: false,
				status: "blocked",
				reason: "tool-not-allowed",
			});
		}
		expect(await execute("read_document")).toEqual({
			ok: true,
			name: "read_document",
		});
		expect(applied).toEqual([]);
	});
	it("AIB3: budget isolation rejects whole batches and ends the turn with a stated reason", () => {
		const turn = createAIToolTurn({
			budget: {
				maxCallsPerTurn: 2,
				maxOpsPerCall: 3,
				maxTotalOpsPerTurn: 4,
			},
		});

		expect(turn.tryRecordCall()).toBe(true);
		expect(turn.tryRecordOps(3)).toBe(null);
		turn.closeCall();
		expect(turn.ended).toBe(false);

		expect(turn.tryRecordCall()).toBe(true);
		// Only 1 op of turn budget remains; the batch of 3 is rejected whole.
		expect(turn.tryRecordOps(3)).toBe("budget-total-ops-exhausted");
		expect(turn.ops).toBe(3);
		expect(turn.ended).toBe(true);
		expect(turn.reason).toBe("budget-total-ops-exhausted");
	});

	it("AIB3: a batch over the per-call limit is rejected whole without ending the turn", () => {
		const turn = createAIToolTurn({
			budget: {
				maxCallsPerTurn: 4,
				maxOpsPerCall: 3,
				maxTotalOpsPerTurn: 10,
			},
		});

		expect(turn.tryRecordCall()).toBe(true);
		expect(turn.tryRecordOps(5)).toBe("budget-ops-per-call-exhausted");
		expect(turn.ops).toBe(0);
		expect(turn.ended).toBe(false);
		turn.closeCall();

		// The next call can still apply ops.
		expect(turn.tryRecordCall()).toBe(true);
		expect(turn.tryRecordOps(3)).toBe(null);
		expect(turn.ops).toBe(3);
	});

	it("AIB3: 100 mutating calls — un-allowlisted blocked, budget ends the turn, only permitted mutations apply", async () => {
		const runtime = new AIToolRuntimeImpl();
		runtime.registerTool(mutatingTool("insert_block"));
		runtime.registerTool(mutatingTool("delete_block"));

		const { editor, applied } = createRecordingEditor();
		const context = new AIToolContextImpl(editor, "doc-1", () => {});
		const turn = createAIToolTurn({
			allowedMutatingTools: ["insert_block"],
		});

		const results = [];
		for (let index = 0; index < 100; index += 1) {
			const name = index % 2 === 0 ? "insert_block" : "delete_block";
			results.push(await executeAITool(runtime, name, {}, context, turn));
		}

		expect(turn.calls).toBe(AI_TOOL_MAX_CALLS_PER_TURN);
		expect(turn.ended).toBe(true);
		expect(turn.reason).toBe("budget-calls-exhausted");

		const permitted = results.filter(
			(result) =>
				result &&
				typeof result === "object" &&
				"ok" in result &&
				result.ok === true,
		);
		const denied = results.filter(isAIToolCallDenied);
		expect(permitted).toHaveLength(AI_TOOL_MAX_CALLS_PER_TURN / 2);
		expect(denied).toHaveLength(100 - AI_TOOL_MAX_CALLS_PER_TURN / 2);
		expect(
			denied.some((result) => result.reason === "tool-not-allowed"),
		).toBe(true);
		expect(denied.some((result) => result.status === "turn-ended")).toBe(
			true,
		);
		expect(applied).toHaveLength(AI_TOOL_MAX_CALLS_PER_TURN / 2);
		expect(applied.every((op) => op.type === "insert-block")).toBe(true);
	});

	it("AIB3: a hostile model double's 100 mutating calls share one undo groupId", async () => {
		const runtime = new AIToolRuntimeImpl();
		runtime.registerTool(mutatingTool("insert_block"));
		runtime.registerTool(mutatingTool("delete_block"));

		const applied: Array<{ ops: DocumentOp[]; options?: ApplyOptions }> =
			[];
		const editor = {
			apply(ops: DocumentOp[], options?: ApplyOptions) {
				applied.push({ ops, options });
			},
			facet: () => null,
			internals: {
				emit() {},
			},
		} as unknown as Editor;
		const context = new AIToolContextImpl(editor, "doc-1", () => {});
		const turn = createAIToolTurn({
			allowedMutatingTools: ["insert_block"],
			groupId: "hostile-turn",
		});
		const double = createModelDouble({
			toolCalls: Array.from({ length: 100 }, (_, index) => ({
				toolCallId: `hostile-${index}`,
				toolName: index % 2 === 0 ? "insert_block" : "delete_block",
				input: {},
			})),
		});

		for await (const event of double.stream({ messages: [], tools: [] })) {
			if (event.type !== "tool-call") {
				continue;
			}
			await executeAITool(
				runtime,
				event.toolName,
				event.input,
				context,
				turn,
			);
		}

		expect(turn.ended).toBe(true);
		expect(turn.reason).toBe("budget-calls-exhausted");
		expect(turn.groupId).toBe("hostile-turn");
		expect(applied).toHaveLength(AI_TOOL_MAX_CALLS_PER_TURN / 2);
		expect(
			applied.every(
				(entry) =>
					entry.options?.undoGroupId === "hostile-turn" &&
					typeof entry.options.origin === "object" &&
					entry.options.origin.groupId === "hostile-turn",
			),
		).toBe(true);
	});

	it("AIB3: confirmation seam refuses destructive tools without applying", async () => {
		const { result, applied, diagnostics } = await runOneCall(
			mutatingTool("delete_block"),
			{ confirm: () => "refuse" },
		);
		expect(result).toEqual({
			ok: false,
			status: "blocked",
			reason: "tool-refused",
		});
		expect(applied).toEqual([]);
		expect(diagnostics).toEqual([]);
	});

	// A deferral is not an unconfirmed run: the resolver answered, so neither
	// unconfirmedDestructive path may also fire.
	it.each([undefined, "allow", "refuse"] as const)(
		"AIB3: deferred confirmation blocks the call without applying or warning (unconfirmedDestructive %s)",
		async (unconfirmedDestructive) => {
			const { result, applied, diagnostics } = await runOneCall(
				mutatingTool("delete_block"),
				{ confirm: () => "defer", unconfirmedDestructive },
			);
			expect(result).toEqual({
				ok: false,
				status: "blocked",
				reason: "tool-confirmation-deferred",
			});
			expect(applied).toEqual([]);
			expect(diagnostics).toEqual([]);
		},
	);

	it("AIB3: absent confirmation allow-with-diagnostic for destructive tools", async () => {
		const { result, applied, diagnostics } = await runOneCall(
			mutatingTool("delete_block"),
		);
		expect(result).toEqual({ ok: true, name: "delete_block" });
		expect(applied).toHaveLength(1);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: AI_TOOL_UNCONFIRMED_CODE,
				message:
					'Destructive tool "delete_block" ran without a confirmation resolver.',
			}),
		]);
	});
	it("AIB3: a destructive resolver is evaluated once per call with the staged context", async () => {
		const resolver = vi.fn(
			(input: unknown) => (input as { wipe?: boolean }).wipe === true,
		);
		const definition: ToolDefinition = {
			...mutatingTool("classified"),
			mutating: true,
			destructive: resolver,
		};
		const confirm = vi.fn(() => "allow" as const);
		const grant = { allowedMutatingTools: ["classified"], confirm };

		const staged = await authorizeAIToolCall(
			"classified",
			{ wipe: true },
			definition,
			grant,
			{ staged: true },
		);
		expect(resolver).toHaveBeenCalledTimes(1);
		expect(resolver).toHaveBeenLastCalledWith(
			{ wipe: true },
			{ staged: true },
		);
		expect(staged.destructive).toBe(true);
		expect(confirm).toHaveBeenCalledTimes(1);

		const harmless = await authorizeAIToolCall(
			"classified",
			{ wipe: false },
			definition,
			grant,
		);
		expect(resolver).toHaveBeenCalledTimes(2);
		// No stated context reads as landing, the conservative direction.
		expect(resolver).toHaveBeenLastCalledWith(
			{ wipe: false },
			{ staged: false },
		);
		expect(harmless).toEqual({
			allowed: true,
			mutating: true,
			destructive: false,
		});
		expect(confirm).toHaveBeenCalledTimes(1);

		// Without a call, the question is "can it be destructive".
		expect(isDestructiveAITool("classified", definition)).toBe(true);
		expect(resolver).toHaveBeenCalledTimes(2);
		expect(
			listAITools({
				listTools: () => [definition],
			} as unknown as Parameters<typeof listAITools>[0])[0]?.destructive,
		).toBe(true);
	});

	it("AIB3: a resolver that throws classifies the call as destructive", async () => {
		const throwing: ToolDefinition = {
			...mutatingTool("throwing"),
			destructive: () => {
				throw new Error("classifier bug");
			},
		};
		const nonBoolean: ToolDefinition = {
			...mutatingTool("non_boolean"),
			destructive: (() => "yes") as unknown as () => boolean,
		};
		for (const definition of [throwing, nonBoolean]) {
			const confirm = vi.fn(() => "refuse" as const);
			const authorization = await authorizeAIToolCall(
				definition.name,
				{},
				definition,
				{ allowedMutatingTools: [definition.name], confirm },
				{ staged: false },
			);
			expect(authorization).toMatchObject({
				allowed: false,
				destructive: true,
				reason: "tool-refused",
			});
			expect(confirm).toHaveBeenCalledTimes(1);
		}
	});

	it("AIB3: unconfirmedDestructive refuse blocks a destructive call with no resolver and emits ai-tool-unconfirmed", async () => {
		const { result, applied, diagnostics } = await runOneCall(
			mutatingTool("delete_block"),
			{ unconfirmedDestructive: "refuse" },
		);
		expect(result).toEqual({
			ok: false,
			status: "blocked",
			reason: "tool-refused",
		});
		expect(applied).toEqual([]);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: AI_TOOL_UNCONFIRMED_CODE,
				message:
					'Destructive tool "delete_block" was refused: no confirmation resolver and unconfirmedDestructive is "refuse".',
			}),
		]);
	});

	it("AIB3: unconfirmedDestructive refuse does not affect a non-destructive call", async () => {
		const { result, applied, diagnostics } = await runOneCall(
			{ ...mutatingTool("classified"), destructive: () => false },
			{ unconfirmedDestructive: "refuse" },
		);
		expect(result).toEqual({ ok: true, name: "classified" });
		expect(applied).toHaveLength(1);
		expect(diagnostics).toEqual([]);
	});
	it("AIB3: an over-budget op batch is rejected whole with a visible error, turn stays open", async () => {
		const runtime = new AIToolRuntimeImpl();
		runtime.registerTool(
			mutatingTool("insert_block", AI_TOOL_MAX_OPS_PER_CALL + 8),
		);
		const { editor, applied } = createRecordingEditor();
		const context = new AIToolContextImpl(editor, "doc-1", () => {});
		const turn = createAIToolTurn({
			allowedMutatingTools: ["insert_block"],
		});

		await expect(
			executeAITool(runtime, "insert_block", {}, context, turn),
		).rejects.toThrow(/per-call limit/);

		expect(applied).toHaveLength(0);
		expect(turn.ops).toBe(0);
		expect(turn.ended).toBe(false);
	});

	it("does not offer un-allowlisted mutating tools when a grant is provided", () => {
		const runtime = new AIToolRuntimeImpl();
		runtime.registerTool({
			name: "read_document",
			description: "Read",
			inputSchema: { type: "object", properties: {} },
			handler: async () => ({ ok: true }),
		});
		runtime.registerTool(mutatingTool("insert_block"));
		runtime.registerTool(mutatingTool("write_document"));

		expect(
			listAITools(runtime, {
				allowedMutatingTools: ["insert_block"],
			}).map((tool) => tool.name),
		).toEqual(["read_document", "insert_block"]);
	});

	it("documents the default budget constants", () => {
		expect(AI_TOOL_MAX_CALLS_PER_TURN).toBe(20);
		expect(AI_TOOL_MAX_OPS_PER_CALL).toBe(200);
		expect(AI_TOOL_MAX_TOTAL_OPS_PER_TURN).toBe(800);
	});
});
