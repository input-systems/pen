// @vitest-environment jsdom

import type {
	ChangeSummary,
	CommitEvent,
	SelectionRecord,
} from "@input/pen-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function emptySummary(
	commitId: number,
	blockIds: readonly string[],
): ChangeSummary {
	return {
		commitId,
		blockText: blockIds.map((blockId) => ({
			blockId,
			splices: [],
			formatRanges: [],
		})),
		structural: [],
		affectedBlockIds: [...blockIds],
	};
}

function record(commitId: number): SelectionRecord {
	return {
		state: null,
		version: commitId,
		origin: "programmatic",
		commitId,
	};
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

describe("DomScheduler I9 collect", () => {
	beforeEach(() => {
		installMockRaf();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("I9 SCH3: collect snapshots commits and selection before the read phase", async () => {
		const scheduler = new DomScheduler("root-a");
		const event = commit(4, ["p1"]);
		const selection = record(4);
		const phases: string[] = [];

		scheduler.acceptCommit(event);
		scheduler.setSelection(selection);
		const readDone = scheduler.read(() => {
			phases.push(scheduler.phase);
			expect(scheduler.collect).toEqual({
				commits: [event],
				selection,
			});
		});

		expect(rafCalls).toBe(1);
		flushFrame();
		await readDone;
		expect(phases).toEqual(["read"]);
		expect(scheduler.collect).toEqual({
			commits: [event],
			selection,
		});
	});

	it("G2: invalidation scan runs in the read phase before queued reads", async () => {
		const order: string[] = [];
		const scheduler = new DomScheduler("root-a", {
			onInvalidate: (blockIds, commitId) => {
				order.push(
					`invalidate:${blockIds.join(",")}:${commitId}:${scheduler.phase}`,
				);
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
		expect(order).toEqual([
			"invalidate:a,b:3:read",
			"read:read",
			"write:write",
		]);
	});

	it("SCH2 G2: measureNow invalidates blocks committed since the last flush before it measures", async () => {
		const invalidated: Array<readonly string[]> = [];
		const scheduler = new DomScheduler("root-a", {
			geometry: {
				invalidateBlocks: (blockIds) => {
					invalidated.push([...blockIds]);
				},
			},
		});

		scheduler.acceptCommit(commit(4, ["a"]));
		const seen = scheduler.measureNow(() =>
			invalidated.map((ids) => ids.join(",")),
		);
		expect(seen).toEqual(["a"]);

		// The commit is still the flush's to collect.
		flushFrame();
		expect(
			scheduler.collect?.commits.map((event) => event.commitId),
		).toEqual([4]);
	});

	it("G2 SCH3: structural split/merge ids join the invalidation scan", async () => {
		const invalidated: Array<{
			blockIds: readonly string[];
			commitId: number;
		}> = [];
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
					{
						type: "block-split",
						blockId: "keep",
						newBlockId: "split",
						offset: 2,
					},
					{
						type: "blocks-merged",
						targetBlockId: "keep",
						sourceBlockId: "gone",
						joinOffset: 4,
					},
				],
			},
		});

		flushFrame();
		expect(invalidated).toEqual([
			{ blockIds: ["keep", "split", "gone"], commitId: 8 },
		]);
	});

	it("I9: read queued during write emits one read-after-write and observes the write on the next flush", async () => {
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
		});

		flushFrame();
		await writeDone;
		expect(diagnostics).toEqual(["read-after-write"]);
		expect(order).toEqual(["write"]);
		expect(rafCalls).toBe(2);

		flushFrame();
		expect(order).toEqual(["write", "read-next:true:read", "read-next-2"]);
		expect(rafCalls).toBe(2);
	});

	it("SCH3: acceptCommit and setSelection coalesce onto one flush per frame", () => {
		const scheduler = new DomScheduler("root-a");
		scheduler.acceptCommit(commit(1, ["p1"]));
		scheduler.acceptCommit(commit(2, ["p2"]));
		scheduler.setSelection(record(2));
		expect(rafCalls).toBe(1);
		flushFrame();
		expect(
			scheduler.collect?.commits.map((event) => event.commitId),
		).toEqual([1, 2]);
		expect(rafCalls).toBe(1);
	});

	it("SCH3: idle scheduler with no commits, selection, or jobs schedules zero flushes", () => {
		new DomScheduler("root-a");
		expect(rafCalls).toBe(0);
		expect(frameQueue).toEqual([]);
	});
});
