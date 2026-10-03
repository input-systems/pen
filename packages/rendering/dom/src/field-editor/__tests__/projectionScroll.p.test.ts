// @vitest-environment jsdom

import type { SelectionRecord } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import { resolveProjectionScroll, scrollDelta } from "../projectionScroll";
import { SelectionProjector } from "../selectionProjector";
import { CLOSED_GESTURE_WINDOWS } from "../selectionReader";

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

describe("projection scroll policy (W3.R15)", () => {
	it("P: auto scroll is on for keyboard, ime, restore and local-user mapped records and off for pointer, programmatic and collaborator-mapped", () => {
		const nearest = { align: "nearest" };
		const local = { commitId: 5, originType: "user" };
		expect(
			resolveProjectionScroll(record("keyboard"), null, "auto"),
		).toEqual(nearest);
		expect(resolveProjectionScroll(record("ime"), null, "auto")).toEqual(
			nearest,
		);
		expect(
			resolveProjectionScroll(record("restore"), null, "auto"),
		).toEqual(nearest);
		expect(
			resolveProjectionScroll(record("mapped"), local, "auto"),
		).toEqual(nearest);

		expect(
			resolveProjectionScroll(record("pointer"), local, "auto"),
		).toBeNull();
		expect(
			resolveProjectionScroll(record("programmatic"), local, "auto"),
		).toBeNull();
		expect(resolveProjectionScroll(record("gc"), local, "auto")).toBeNull();
		expect(
			resolveProjectionScroll(
				record("mapped"),
				{ commitId: 5, originType: "collaborator" },
				"auto",
			),
		).toBeNull();
		// A mapped record from an older commit is not this local edit.
		expect(
			resolveProjectionScroll(record("mapped", 4), local, "auto"),
		).toBeNull();
	});

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

describe("projection scroll jobs (W3.R15)", () => {
	function projectorFor(origin: SelectionRecord["origin"]) {
		const element = document.createElement("span");
		document.body.append(element);
		const jobs: string[] = [];
		const projector = new SelectionProjector({
			getGestureWindows: () => CLOSED_GESTURE_WINDOWS,
			isEditing: () => true,
			getMode: () => "single",
			getFocusBlockId: () => "first",
			getAttachedElement: () => element,
			getRootElement: () => document.body,
			findExpandedHost: () => null,
			resolveInlineElement: () => element,
			attachElement: () => true,
			requestDomFocus: () => true,
			updateBackendSelection: () => {},
			setTextSelection: () => {},
			activate: () => {},
			emitSelectionProjected: () => {},
			getRecord: () => record(origin),
			getScheduler: () => ({
				read: async () => {
					jobs.push("read");
				},
				write: async () => {
					jobs.push("write");
				},
			}),
		});
		return { projector, jobs };
	}

	it("P: a keyboard projection queues one measure read and one scroll write; a pointer projection queues none", () => {
		const keyboard = projectorFor("keyboard");
		keyboard.projector.project("selection-change");
		expect(keyboard.jobs).toEqual(["read", "write"]);

		const pointer = projectorFor("pointer");
		pointer.projector.project("selection-change");
		expect(pointer.jobs).toEqual([]);
	});

	it("P: scrollIntoView queues the same read and write for W4's scrollToBlock", () => {
		const { projector, jobs } = projectorFor("pointer");
		projector.scrollIntoView({ blockId: "first" }, { align: "start" });
		expect(jobs).toEqual(["read", "write"]);
	});
});
