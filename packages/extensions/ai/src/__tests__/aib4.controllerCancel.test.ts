import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { toolsExtension } from "@input/pen-tools";
import type { Editor, ModelAdapter, ModelStreamEvent } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { aiExtension, getAIController } from "../index";
import { deltaStreamExtension } from "../stream";

/**
 * AIB4 at the controller: one AI action is one undo step even when the user
 * cancels it mid-stream or types elsewhere while it writes. The stream-level
 * pins live in `stream/__tests__/aib4.undoGrouping.test.ts`; these drive the
 * real controller, whose block continuation writes through `openTextStream`
 * (the `direct-write` sink) under the run's group id.
 */

const SEED = "Hello world";
const DELTAS = [" and", " more", " text", " after"] as const;

let editor: Editor | null = null;

afterEach(() => {
	editor?.destroy();
	editor = null;
});

interface Gate {
	/** Resolves once the stream has handed over `count` deltas and paused. */
	waitForDeltas(count: number): Promise<void>;
	release(): void;
}

/**
 * A model that pauses after every delta until the test releases it. The
 * consumer has handled a delta before it asks for the next event, so "paused
 * after delta n" means delta n has landed.
 */
function gatedTextModel(deltas: readonly string[]): {
	model: ModelAdapter;
	gate: Gate;
} {
	let delivered = 0;
	let releaseStep: (() => void) | null = null;
	const waiters: Array<{ count: number; resolve: () => void }> = [];
	const notify = () => {
		for (const waiter of [...waiters]) {
			if (delivered >= waiter.count) {
				waiters.splice(waiters.indexOf(waiter), 1);
				waiter.resolve();
			}
		}
	};
	const model: ModelAdapter = {
		async *stream() {
			for (const delta of deltas) {
				yield { type: "text-delta", delta } as ModelStreamEvent;
				await new Promise<void>((resolve) => {
					releaseStep = resolve;
					delivered += 1;
					notify();
				});
			}
			yield { type: "done" } as ModelStreamEvent;
		},
	};
	return {
		model,
		gate: {
			waitForDeltas: (count) =>
				new Promise<void>((resolve) => {
					waiters.push({ count, resolve });
					notify();
				}),
			release: () => {
				const step = releaseStep;
				releaseStep = null;
				step?.();
			},
		},
	};
}

function createControllerEditor(model: ModelAdapter): Editor {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({ model, mutationPreference: "direct" }),
		],
	});
}

function text(blockId: string): string | undefined {
	return editor?.getBlock(blockId)?.textContent();
}

describe("AIB4: controller-run streams undo as one step", () => {
	it("AIB4: cancelSession during an openTextStream rewrite leaves one undo step covering the landed prefix", async () => {
		const { model, gate } = gatedTextModel(DELTAS);
		editor = createControllerEditor(model);
		await editor.whenReady();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: SEED }],
			{ origin: "system" },
		);
		const controller = getAIController(editor)!;

		const session = controller.startSession({
			surface: "inline-edit",
			target: "block",
		});
		const running = controller.runSessionPrompt(session.id, "Continue", {
			blockId,
		});
		await gate.waitForDeltas(1);
		gate.release();
		await gate.waitForDeltas(2);
		const landed = `${SEED}${DELTAS[0]}${DELTAS[1]}`;
		// The writer flushes on its own interval; wait for the commit rather
		// than assume it.
		await vi.waitFor(() => expect(text(blockId)).toBe(landed));
		// A watched continuation: written as it arrives, through
		// `openTextStream`, not staged.
		const active = controller.getState().activeGeneration;
		expect(active?.route).toBe("cursor-context");
		expect(active?.mutationMode).toBe("direct-stream");
		expect(active?.sessionId).toBe(session.id);

		controller.cancelSession(session.id);
		gate.release();
		const generation = await running;

		expect(generation.status).toBe("cancelled");
		expect(
			controller
				.getState()
				.sessions.find((item) => item.id === session.id)?.status,
		).toBe("cancelled");
		expect(text(blockId)).toBe(landed);

		expect(editor.undoManager.undo()).toBe(true);
		expect(text(blockId)).toBe(SEED);
		expect(editor.undoManager.canUndo()).toBe(false);
	});

	it("AIB4: user typing in another block during a controller-run stream stays after the AI step is undone", async () => {
		const { model, gate } = gatedTextModel(DELTAS);
		editor = createControllerEditor(model);
		await editor.whenReady();
		const aiBlockId = editor.firstBlock()!.id;
		const userBlockId = "typed";
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: aiBlockId,
					from: 0,
					to: 0,
					insert: SEED,
				},
				{
					type: "insert-block",
					blockId: userBlockId,
					blockType: "paragraph",
					props: {},
					position: "last",
				},
				{
					type: "splice-text",
					blockId: userBlockId,
					from: 0,
					to: 0,
					insert: "Notes",
				},
			],
			{ origin: "system" },
		);
		const controller = getAIController(editor)!;

		const running = controller.runPrompt("Continue", {
			blockId: aiBlockId,
		});
		await gate.waitForDeltas(1);
		await vi.waitFor(() =>
			expect(text(aiBlockId)).toBe(`${SEED}${DELTAS[0]}`),
		);
		// Typed between two writes of the action: it names no group, so it
		// neither closes the AI step nor joins it (W0.R2).
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: userBlockId,
					from: 5,
					to: 5,
					insert: " typed",
				},
			],
			{ origin: "user" },
		);
		for (let index = 1; index <= DELTAS.length; index += 1) {
			gate.release();
			if (index < DELTAS.length) {
				await gate.waitForDeltas(index + 1);
			}
		}
		const generation = await running;
		expect(generation.status).toBe("complete");
		expect(text(aiBlockId)).toBe(`${SEED}${DELTAS.join("")}`);
		expect(text(userBlockId)).toBe("Notes typed");

		expect(editor.undoManager.undo()).toBe(true);
		expect(text(aiBlockId)).toBe(SEED);
		expect(text(userBlockId)).toBe("Notes typed");

		expect(editor.undoManager.undo()).toBe(true);
		expect(text(aiBlockId)).toBe(SEED);
		expect(text(userBlockId)).toBe("Notes");
	});
});
