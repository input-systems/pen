// @vitest-environment jsdom

import { createHeadlessEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { SelectionRecord } from "@input/pen-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReconciler } from "../field-editor/sessionReconciler";
import { DomScheduler } from "../scheduler";

let frameQueue: FrameRequestCallback[] = [];
let rafCalls = 0;

function installMockRaf(): void {
	frameQueue = [];
	rafCalls = 0;
	vi.stubGlobal(
		"requestAnimationFrame",
		(callback: FrameRequestCallback): number => {
			rafCalls += 1;
			frameQueue.push(callback);
			return frameQueue.length;
		},
	);
}

function flushFrame(): void {
	const batch = frameQueue.splice(0);
	for (const callback of batch) {
		callback(0);
	}
}

function record(version: number): SelectionRecord {
	return {
		state: null,
		version,
		origin: "programmatic",
		commitId: version,
	};
}

describe("DomScheduler CS6 session reconcile", () => {
	beforeEach(() => {
		installMockRaf();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("CS6: write-phase reconcile runs before the post-flush project", () => {
		const order: string[] = [];
		const scheduler = new DomScheduler("root-a");

		void scheduler.write(() => {
			order.push("reconcile");
			order.push("project-after-flush");
		});
		scheduler.setSelection(record(3));

		expect(order).toEqual([]);
		expect(rafCalls).toBe(1);
		flushFrame();
		expect(order).toEqual(["reconcile", "project-after-flush"]);
		expect(rafCalls).toBe(1);
	});

	it("CS6: SessionReconciler history flush shares the scheduler frame and projects after reconcile", () => {
		const order: string[] = [];
		const scheduler = new DomScheduler("root-a");
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const reconciler = new SessionReconciler(editor, {
			getSnapshot: () => ({
				focusBlockId: blockId,
				activeBlockIds: [blockId],
				isEditing: true,
				mode: "single",
			}),
			getAttachedElement: () => null,
			getInlineElement: () => null,
			getYText: () => {
				order.push("reconcile");
				return null;
			},
			projectAfterRebuild: () => {},
			shouldProjectSelection: () => true,
			projectSelection: () => {
				order.push("project-after-flush");
			},
			getScheduler: () => scheduler,
		});

		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "a",
				},
			],
			{ origin: { type: "history", source: "undo" } },
		);
		scheduler.setSelection(record(1));

		expect(order).toEqual([]);
		expect(rafCalls).toBe(1);
		flushFrame();
		expect(order).toEqual(["reconcile", "project-after-flush"]);
		expect(rafCalls).toBe(1);

		reconciler.destroy();
		editor.destroy();
	});

	it("CS6: pending reconcile waits for a scheduler and still projects after flush", () => {
		const order: string[] = [];
		let scheduler: DomScheduler | null = null;
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const reconciler = new SessionReconciler(editor, {
			getSnapshot: () => ({
				focusBlockId: blockId,
				activeBlockIds: [blockId],
				isEditing: true,
				mode: "single",
			}),
			getAttachedElement: () => null,
			getInlineElement: () => null,
			getYText: () => {
				order.push("reconcile");
				return null;
			},
			projectAfterRebuild: () => {},
			shouldProjectSelection: () => true,
			projectSelection: () => {
				order.push("project-after-flush");
			},
			getScheduler: () => scheduler,
		});

		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "a",
				},
			],
			{ origin: { type: "history", source: "undo" } },
		);

		expect(order).toEqual([]);
		expect(rafCalls).toBe(0);

		scheduler = new DomScheduler("root-a");
		reconciler.notifyFrameAvailable();
		expect(order).toEqual([]);
		expect(rafCalls).toBe(1);
		flushFrame();
		expect(order).toEqual(["reconcile", "project-after-flush"]);

		reconciler.destroy();
		editor.destroy();
	});
});
