// @vitest-environment jsdom

import { createHeadlessEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { ChangeSummary, CommitEvent, SelectionRecord } from "@input/pen-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionReconciler } from "../field-editor/sessionReconciler";
import { DomScheduler } from "../scheduler";

let frameQueue: FrameRequestCallback[] = [];
let rafCalls = 0;

beforeEach(() => {
	frameQueue = [];
	rafCalls = 0;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
		rafCalls += 1;
		frameQueue.push(callback);
		return frameQueue.length;
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function flushFrame(): void {
	for (const callback of frameQueue.splice(0)) callback(0);
}

function emptySummary(commitId: number, blockIds: readonly string[]): ChangeSummary {
	return {
		commitId,
		blockText: blockIds.map((blockId) => ({ blockId, splices: [], formatRanges: [] })),
		structural: [],
		affectedBlockIds: [...blockIds],
	};
}

function record(commitId: number): SelectionRecord {
	return { state: null, version: commitId, origin: "programmatic", commitId };
}

function commit(commitId: number, blockIds: readonly string[]): CommitEvent {
	return {
		commitId,
		origin: { type: "user" },
		summary: emptySummary(commitId, blockIds),
		selectionBefore: record(commitId - 1),
		selectionAfter: record(commitId),
		source: "apply",
		diagnostics: [],
	};
}

describe("DomScheduler", () => {
	it("SCH1 SCH3 I9: flush runs queued reads FIFO then writes FIFO with matching phase", async () => {
		const scheduler = new DomScheduler("root-a");
		const order: string[] = [];
		const queued = [
			scheduler.read(() => order.push(`read-1:${scheduler.phase}`)),
			scheduler.read(() => order.push(`read-2:${scheduler.phase}`)),
			scheduler.write(() => order.push(`write-1:${scheduler.phase}`)),
			scheduler.write(() => order.push(`write-2:${scheduler.phase}`)),
		];

		expect(scheduler.phase).toBe("idle");
		expect(order).toEqual([]);
		flushFrame();
		await Promise.all(queued);

		expect(order).toEqual(["read-1:read", "read-2:read", "write-1:write", "write-2:write"]);
		expect(scheduler.phase).toBe("idle");
	});

	it("SCH3: routes nested schedules — writes during read run in this flush, reads during write go to the next", async () => {
		const scheduler = new DomScheduler("root-a");
		const order: string[] = [];

		const firstWrite = scheduler.write(() => {
			order.push("write");
			void scheduler.read(() => {
				order.push("read-next");
			});
		});
		const firstRead = scheduler.read(() => {
			order.push("read");
			void scheduler.write(() => {
				order.push("write-this");
			});
		});

		flushFrame();
		await Promise.all([firstRead, firstWrite]);
		expect(order).toEqual(["read", "write", "write-this"]);

		flushFrame();
		expect(order).toEqual(["read", "write", "write-this", "read-next"]);
	});

	it("SCH3: runs one flush per animation frame", () => {
		const scheduler = new DomScheduler("root-a");
		let flushCount = 0;
		const count = () => {
			flushCount += 1;
		};
		void scheduler.read(count);
		void scheduler.read(count);
		void scheduler.write(count);

		expect(rafCalls).toBe(1);
		flushFrame();
		expect(flushCount).toBe(3);
		expect(rafCalls).toBe(1);
	});

	it("SCH3: schedules zero flushes when idle", () => {
		new DomScheduler("root-a");
		expect(rafCalls).toBe(0);
		expect(frameQueue).toEqual([]);
	});

	it("SCH3: appends reads queued during the read phase to this flush", async () => {
		const scheduler = new DomScheduler("root-a");
		const order: string[] = [];
		const first = scheduler.read(() => {
			order.push("read-1");
			void scheduler.read(() => {
				order.push("read-2");
			});
		});

		flushFrame();
		await first;
		expect(order).toEqual(["read-1", "read-2"]);
		expect(rafCalls).toBe(1);
	});

	it("SCH2: measureNow increments the diagnostics-visible counter once per call", async () => {
		const scheduler = new DomScheduler("root-a");
		expect(scheduler.diagnostics.measureNowCount).toBe(0);

		expect(scheduler.measureNow(() => "caret")).toBe("caret");
		expect(scheduler.diagnostics.measureNowCount).toBe(1);

		const duringFlush = scheduler.read(() => {
			expect(scheduler.measureNow(() => scheduler.phase)).toBe("read");
		});
		const afterRead = scheduler.write(() => {
			expect(scheduler.measureNow(() => scheduler.phase)).toBe("write");
		});
		flushFrame();
		await Promise.all([duringFlush, afterRead]);

		expect(() => {
			scheduler.measureNow(() => {
				throw new Error("sync measure failed");
			});
		}).toThrow("sync measure failed");
		expect(scheduler.diagnostics.measureNowCount).toBe(4);
		expect(scheduler.phase).toBe("idle");
	});

	it("SCH1 SCH2: measureNow is the sync measure path and does not change phase or schedule a flush", () => {
		const scheduler = new DomScheduler("root-a");
		const measured = scheduler.measureNow(() => {
			expect(scheduler.phase).toBe("idle");
			return 42;
		});

		expect(measured).toBe(42);
		expect(scheduler.diagnostics.measureNowCount).toBe(1);
		expect(scheduler.phase).toBe("idle");
		expect(rafCalls).toBe(0);
		expect(frameQueue).toEqual([]);
	});

	it("SCH3: per-root schedulers keep queues, phases, and measureNow counts isolated", async () => {
		const alpha = new DomScheduler("root-a");
		const beta = new DomScheduler({ rootId: "root-b" });
		const order: string[] = [];
		expect(alpha.rootId).toBe("root-a");
		expect(beta.rootId).toBe("root-b");

		expect(alpha.measureNow(() => "a")).toBe("a");
		expect(alpha.diagnostics.measureNowCount).toBe(1);
		expect(beta.diagnostics.measureNowCount).toBe(0);

		const alphaDone = alpha.write(() => {
			order.push("a-write");
			expect(alpha.phase).toBe("write");
			expect(beta.phase).toBe("idle");
			void beta.read(() => {
				order.push(`b-read:${beta.phase}`);
			});
		});

		expect(rafCalls).toBe(1);
		flushFrame();
		await alphaDone;
		expect(order).toEqual(["a-write"]);
		expect(alpha.phase).toBe("idle");
		expect(beta.phase).toBe("idle");

		flushFrame();
		expect(order).toEqual(["a-write", "b-read:read"]);
		expect(alpha.diagnostics.measureNowCount).toBe(1);
		expect(beta.diagnostics.measureNowCount).toBe(0);
	});

	it("SCH3: a write queued on another root during this root's read phase waits for that root's flush", () => {
		const alpha = new DomScheduler("root-a");
		const beta = new DomScheduler("root-b");
		const order: string[] = [];
		void alpha.read(() => {
			order.push("a-read");
			void beta.write(() => order.push("b-write"));
		});
		void alpha.write(() => order.push("a-write"));

		flushFrame();
		expect(order).toEqual(["a-read", "a-write"]);
		flushFrame();
		expect(order).toEqual(["a-read", "a-write", "b-write"]);
	});

	it("SCH2 SCH3 I9: a read queued during write emits one read-after-write and observes the write on the next flush", async () => {
		const diagnostics: string[] = [];
		const order: string[] = [];
		const scheduler = new DomScheduler("root-a", {
			onDiagnostic: (event) => {
				diagnostics.push(event.code);
			},
		});

		let mutated = false;
		const writeDone = scheduler.write(() => {
			mutated = true;
			order.push("write");
			void scheduler.read(() => {
				order.push(`read-next:${mutated}:${scheduler.phase}`);
			});
			void scheduler.read(() => {
				order.push("read-next-2");
			});
			expect(scheduler.measureNow(() => "sync")).toBe("sync");
		});

		flushFrame();
		await writeDone;
		expect(diagnostics).toEqual(["read-after-write"]);
		expect(scheduler.diagnostics.measureNowCount).toBe(1);
		expect(order).toEqual(["write"]);
		expect(rafCalls).toBe(2);

		flushFrame();
		expect(order).toEqual(["write", "read-next:true:read", "read-next-2"]);
		expect(rafCalls).toBe(2);
	});
});

describe("DomScheduler I9 collect", () => {
	it("I9 SCH3: collect snapshots commits and selection before the read phase", async () => {
		const scheduler = new DomScheduler("root-a");
		const event = commit(4, ["p1"]);
		const selection = record(4);
		const phases: string[] = [];

		scheduler.acceptCommit(event);
		scheduler.setSelection(selection);
		const readDone = scheduler.read(() => {
			phases.push(scheduler.phase);
			expect(scheduler.collect).toEqual({ commits: [event], selection });
		});

		expect(rafCalls).toBe(1);
		flushFrame();
		await readDone;
		expect(phases).toEqual(["read"]);
		expect(scheduler.collect).toEqual({ commits: [event], selection });
	});

	it("G2: invalidation scan runs in the read phase before queued reads", async () => {
		const order: string[] = [];
		const scheduler = new DomScheduler("root-a", {
			onInvalidate: (blockIds, commitId) => {
				order.push(`invalidate:${blockIds.join(",")}:${commitId}:${scheduler.phase}`);
			},
		});

		scheduler.acceptCommit(commit(3, ["a", "b"]));
		const readDone = scheduler.read(() => {
			order.push(`read:${scheduler.phase}`);
		});
		const writeDone = scheduler.write(() => {
			order.push(`write:${scheduler.phase}`);
		});

		flushFrame();
		await Promise.all([readDone, writeDone]);
		expect(order).toEqual(["invalidate:a,b:3:read", "read:read", "write:write"]);
	});

	it("SCH2 G2: measureNow invalidates blocks committed since the last flush before it measures", () => {
		const invalidated: Array<readonly string[]> = [];
		const scheduler = new DomScheduler("root-a", {
			geometry: {
				invalidateBlocks: (blockIds) => {
					invalidated.push([...blockIds]);
				},
			},
		});

		scheduler.acceptCommit(commit(4, ["a"]));
		expect(scheduler.measureNow(() => invalidated.map((ids) => ids.join(",")))).toEqual(["a"]);

		// The commit is still the flush's to collect.
		flushFrame();
		expect(scheduler.collect?.commits.map((event) => event.commitId)).toEqual([4]);
	});

	it("G2 SCH3: structural split/merge ids join the invalidation scan", () => {
		const invalidated: Array<{ blockIds: readonly string[]; commitId: number }> = [];
		const scheduler = new DomScheduler("root-a", {
			onInvalidate: (blockIds, commitId) => {
				invalidated.push({ blockIds, commitId });
			},
		});

		scheduler.acceptCommit({
			...commit(8, ["keep"]),
			summary: {
				...emptySummary(8, ["keep"]),
				structural: [
					{ type: "block-split", blockId: "keep", newBlockId: "split", offset: 2 },
					{ type: "blocks-merged", targetBlockId: "keep", sourceBlockId: "gone", joinOffset: 4 },
				],
			},
		});

		flushFrame();
		expect(invalidated).toEqual([{ blockIds: ["keep", "split", "gone"], commitId: 8 }]);
	});

	it("SCH3: acceptCommit and setSelection coalesce onto one flush per frame", () => {
		const scheduler = new DomScheduler("root-a");
		scheduler.acceptCommit(commit(1, ["p1"]));
		scheduler.acceptCommit(commit(2, ["p2"]));
		scheduler.setSelection(record(2));
		expect(rafCalls).toBe(1);
		flushFrame();
		expect(scheduler.collect?.commits.map((event) => event.commitId)).toEqual([1, 2]);
		expect(rafCalls).toBe(1);
	});
});

describe("DomScheduler without a projector slot (P4)", () => {
	it("P4: a flush collects the selection record once and retains nothing for a later flush", () => {
		const scheduler = new DomScheduler("root-a");
		const order: string[] = [];
		const writeSeenSelection = () =>
			void scheduler.write(() => {
				order.push(`write:${scheduler.collect?.selection?.version ?? "none"}`);
			});

		writeSeenSelection();
		scheduler.setSelection(record(7));
		flushFrame();
		expect(order).toEqual(["write:7"]);

		writeSeenSelection();
		flushFrame();
		expect(order).toEqual(["write:7", "write:none"]);
		expect(scheduler.phase).toBe("idle");
	});

	it("P4: the scheduler exposes no projector seam", () => {
		const scheduler = new DomScheduler("root-a");
		expect("setProjector" in scheduler).toBe(false);
		expect("projectedThisFlush" in scheduler).toBe(false);
	});
});

describe("DomScheduler CS6 session reconcile", () => {
	/** A reconciler over an editing field that logs its reconcile and project steps after an undo commit. */
	function reconcileAfterUndo(getScheduler: () => DomScheduler | null) {
		const order: string[] = [];
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const reconciler = new SessionReconciler(editor, {
			getSnapshot: () => ({ focusBlockId: blockId, activeBlockIds: [blockId], isEditing: true, mode: "single" }),
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
			getScheduler,
		});
		editor.apply([{ type: "splice-text", blockId, from: 0, to: 0, insert: "a" }], {
			origin: { type: "history", source: "undo" },
		});
		return {
			order,
			reconciler,
			destroy: () => {
				reconciler.destroy();
				editor.destroy();
			},
		};
	}

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
		const scheduler = new DomScheduler("root-a");
		const { order, destroy } = reconcileAfterUndo(() => scheduler);
		scheduler.setSelection(record(1));

		expect(order).toEqual([]);
		expect(rafCalls).toBe(1);
		flushFrame();
		expect(order).toEqual(["reconcile", "project-after-flush"]);
		expect(rafCalls).toBe(1);
		destroy();
	});

	it("CS6: pending reconcile waits for a scheduler and still projects after flush", () => {
		let scheduler: DomScheduler | null = null;
		const { order, reconciler, destroy } = reconcileAfterUndo(() => scheduler);
		expect(order).toEqual([]);
		expect(rafCalls).toBe(0);

		scheduler = new DomScheduler("root-a");
		reconciler.notifyFrameAvailable();
		expect(order).toEqual([]);
		expect(rafCalls).toBe(1);
		flushFrame();
		expect(order).toEqual(["reconcile", "project-after-flush"]);
		destroy();
	});
});
