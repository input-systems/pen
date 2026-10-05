// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomScheduler } from "../scheduler";
import { record } from "./scheduler.testHelpers";

let frameQueue: FrameRequestCallback[] = [];

function installMockRaf(): void {
	frameQueue = [];
	vi.stubGlobal(
		"requestAnimationFrame",
		(callback: FrameRequestCallback): number => {
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

describe("DomScheduler without a projector slot (P4)", () => {
	beforeEach(() => {
		installMockRaf();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("P4: a flush collects the selection record once and retains nothing for a later flush", () => {
		const scheduler = new DomScheduler("root-a");
		const order: string[] = [];

		void scheduler.write(() => {
			order.push(
				`write:${scheduler.collect?.selection?.version ?? "none"}`,
			);
		});
		scheduler.setSelection(record(7));
		flushFrame();
		expect(order).toEqual(["write:7"]);

		void scheduler.write(() => {
			order.push(
				`write:${scheduler.collect?.selection?.version ?? "none"}`,
			);
		});
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
