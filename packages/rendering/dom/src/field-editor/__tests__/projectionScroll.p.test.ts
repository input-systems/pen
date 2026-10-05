// @vitest-environment jsdom

import type { SelectionRecord } from "@input/pen-types";
import { describe, expect, it, vi } from "vitest";
import {
	applyScrollPlan,
	resolveProjectionScroll,
	scrollDelta,
} from "../projectionScroll";
import type * as ProjectionScrollModule from "../projectionScroll";
import { createTestProjector } from "./selectionProjector.testHelpers";

vi.mock("../projectionScroll", async (importOriginal) => ({
	...(await importOriginal<typeof ProjectionScrollModule>()),
	// jsdom has no layout: every measure finds the target 10px below the view.
	measureScrollPlan: (root: Element) => ({ container: root, dx: 0, dy: 10 }),
	applyScrollPlan: vi.fn(),
}));

function record(
	origin: SelectionRecord["origin"],
	commitId = 5,
): SelectionRecord {
	return {
		state: {
			type: "text",
			anchor: { blockId: "first", offset: 1 },
			focus: { blockId: "first", offset: 1 },
			affinity: "downstream",
			goalX: null,
		},
		version: 3,
		origin,
		commitId,
	};
}

function rect(top: number, bottom: number) {
	return {
		x: 0,
		y: top,
		width: 10,
		height: bottom - top,
		top,
		left: 0,
		right: 10,
		bottom,
	};
}

describe("projection scroll policy (P)", () => {
	const LOCAL = { commitId: 5, originType: "user" };
	it.each<[string, SelectionRecord, typeof LOCAL | null, boolean]>([
		["keyboard", record("keyboard"), null, true],
		["ime", record("ime"), null, true],
		["restore", record("restore"), null, true],
		["local-user mapped", record("mapped"), LOCAL, true],
		["pointer", record("pointer"), LOCAL, false],
		["programmatic", record("programmatic"), LOCAL, false],
		["gc", record("gc"), LOCAL, false],
		[
			"collaborator-mapped",
			record("mapped"),
			{ commitId: 5, originType: "collaborator" },
			false,
		],
		// A mapped record from an older commit is not this local edit.
		["older-commit mapped", record("mapped", 4), LOCAL, false],
	])(
		"P: auto scroll policy for a %s record",
		(_label, current, commit, scrolls) => {
			expect(resolveProjectionScroll(current, commit, "auto")).toEqual(
				scrolls ? { align: "nearest" } : null,
			);
		},
	);

	it("P: an explicit alignment always scrolls and none never does", () => {
		expect(
			resolveProjectionScroll(record("pointer"), null, {
				align: "center",
			}),
		).toEqual({ align: "center" });
		expect(
			resolveProjectionScroll(record("keyboard"), null, "none"),
		).toBeNull();
	});

	it("P: nearest scrolls only as far as needed; start, center and end align the target", () => {
		const view = rect(100, 300);
		expect(scrollDelta(view, rect(150, 170), "nearest")).toBeNull();
		expect(scrollDelta(view, rect(320, 340), "nearest")).toEqual({
			dx: 0,
			dy: 40,
		});
		expect(scrollDelta(view, rect(60, 80), "nearest")).toEqual({
			dx: 0,
			dy: -40,
		});
		expect(scrollDelta(view, rect(150, 170), "start")).toEqual({
			dx: 0,
			dy: 50,
		});
		expect(scrollDelta(view, rect(150, 170), "center")).toEqual({
			dx: 0,
			dy: -40,
		});
		expect(scrollDelta(view, rect(150, 170), "end")).toEqual({
			dx: 0,
			dy: -130,
		});
	});

	it("P: a fractional delta rounds away from zero so the target lands fully in view", () => {
		const view = rect(0, 720);
		expect(scrollDelta(view, rect(702.375, 720.375), "nearest")).toEqual({
			dx: 0,
			dy: 1,
		});
		expect(scrollDelta(view, rect(-0.5, 17.5), "nearest")).toEqual({
			dx: 0,
			dy: -1,
		});
	});
});

describe("projection scroll jobs (P)", () => {
	function projectorFor(origin: SelectionRecord["origin"]) {
		const jobs: string[] = [];
		const reads: Array<() => void> = [];
		const writes: Array<() => void> = [];
		const { projector } = createTestProjector({
			getRecord: () => record(origin),
			getScheduler: () => ({
				read: async (job: () => void) => {
					jobs.push("read");
					reads.push(job);
				},
				write: async (job: () => void) => {
					jobs.push("write");
					writes.push(job);
				},
			}),
		});
		/** One scheduler flush: every queued read, then every queued write. */
		function flush(): void {
			for (const job of reads.splice(0)) job();
			for (const job of writes.splice(0)) job();
		}
		return { projector, jobs, flush };
	}

	it("P: a keyboard projection queues one measure read and one scroll write; a pointer projection queues none", () => {
		const keyboard = projectorFor("keyboard");
		keyboard.projector.project("selection-change");
		keyboard.flush();
		expect(keyboard.jobs).toEqual(["read", "write"]);

		const pointer = projectorFor("pointer");
		pointer.projector.project("selection-change");
		expect(pointer.jobs).toEqual([]);
	});

	it("P: a version projected twice before the flush scrolls once, not by twice the measured delta", () => {
		vi.mocked(applyScrollPlan).mockClear();
		const { projector, flush } = projectorFor("keyboard");
		// A keyboard move onto another block projects on `selection-change`
		// and again on the newly active field's `activation`; both queue a
		// measure against the same layout.
		projector.project("selection-change");
		projector.project("activation");
		flush();
		expect(vi.mocked(applyScrollPlan)).toHaveBeenCalledTimes(1);
	});

	it("P: scrollIntoView queues the same read and write for a host's scrollToBlock", () => {
		const { projector, jobs, flush } = projectorFor("pointer");
		projector.scrollIntoView({ blockId: "first" }, { align: "start" });
		flush();
		expect(jobs).toEqual(["read", "write"]);
	});

	it("P: a scroll scheduled from a write phase writes after its own measure, in the next flush", () => {
		vi.mocked(applyScrollPlan).mockClear();
		const { projector, jobs, flush } = projectorFor("restore");
		projector.project("selection-change");
		flush();
		expect(vi.mocked(applyScrollPlan)).toHaveBeenCalledTimes(1);
		// A rebuilt target re-projects the same version from a write phase;
		// its write is queued by its read, not beside it.
		jobs.length = 0;
		projector.project("target-rebuilt");
		expect(jobs).toEqual(["read"]);
		flush();
		expect(jobs).toEqual(["read", "write"]);
		expect(vi.mocked(applyScrollPlan)).toHaveBeenCalledTimes(2);
	});
});
