// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOverlayFixture,
	flushFrame,
	focusCaretContributor,
	installMockRaf,
	pendingFrames,
	type OverlayFixture,
} from "../overlay/__tests__/overlayFixture";
import { DomScheduler, type OverlayPainter } from "../scheduler";

describe("DomScheduler overlay paint slot (W35.R1)", () => {
	let fixture: OverlayFixture | null = null;

	beforeEach(() => {
		installMockRaf();
	});

	afterEach(() => {
		fixture?.destroy();
		fixture = null;
		vi.unstubAllGlobals();
	});

	it("SCH: the overlay reads at the end of the read phase and paints after the projector", () => {
		const order: string[] = [];
		const scheduler = new DomScheduler("sch-order");
		const painter: OverlayPainter = {
			read: () => {
				order.push(`painter.read:${scheduler.phase}`);
			},
			paint: ({ ranWrites }) => {
				order.push(`painter.paint:${scheduler.phase}:${ranWrites}`);
			},
		};
		scheduler.setOverlayPainter(painter);

		void scheduler.write(() => {
			order.push("write");
		});
		void scheduler.read(() => {
			order.push("read");
			// A read queued from the read phase still runs before the overlay read.
			void scheduler.read(() => {
				order.push("nested-read");
			});
		});
		void scheduler.write(() => {
			order.push("project");
		});
		flushFrame();

		expect(order).toEqual([
			"read",
			"nested-read",
			"painter.read:read",
			"write",
			"project",
			"painter.paint:write:true",
		]);
		expect(scheduler.diagnostics.flushCount).toBe(1);
		expect(scheduler.diagnostics.paintCount).toBe(1);
	});

	it("SCH: requestPaint coalesces to one flush per frame and an idle scheduler flushes zero times", () => {
		const scheduler = new DomScheduler("sch-coalesce");
		const paints: boolean[] = [];
		scheduler.setOverlayPainter({
			read: () => {},
			paint: ({ ranWrites }) => {
				paints.push(ranWrites);
			},
		});

		flushFrame();
		expect(scheduler.diagnostics.flushCount).toBe(0);

		for (let index = 0; index < 5; index += 1) {
			scheduler.requestPaint();
		}
		expect(pendingFrames()).toBe(1);
		flushFrame();
		expect(scheduler.diagnostics.flushCount).toBe(1);
		expect(paints).toEqual([false]);

		flushFrame();
		flushFrame();
		expect(pendingFrames()).toBe(0);
		expect(scheduler.diagnostics.flushCount).toBe(1);
	});

	it("SCH: a flush that ran queued writes requests one follow-up paint and a paint-only flush requests none", () => {
		fixture = createOverlayFixture();
		const { editor, blockId, scheduler, controller } = fixture;
		controller.registerContributor(focusCaretContributor());
		editor.selectText(blockId, 2, 2, { origin: "keyboard" });
		flushFrame();
		// The paint-only flush that painted the caret ran no writes.
		const settled = scheduler.diagnostics.flushCount;
		flushFrame();
		expect(scheduler.diagnostics.flushCount).toBe(settled);
		expect(controller.plan?.items).toHaveLength(1);

		void scheduler.write(() => {});
		flushFrame();
		expect(scheduler.diagnostics.flushCount).toBe(settled + 1);
		expect(pendingFrames()).toBe(1);
		flushFrame();
		expect(scheduler.diagnostics.flushCount).toBe(settled + 2);
		flushFrame();
		flushFrame();
		expect(pendingFrames()).toBe(0);
		expect(scheduler.diagnostics.flushCount).toBe(settled + 2);
	});

	it("SCH: a flush whose overlay inputs are unchanged measures nothing", () => {
		fixture = createOverlayFixture();
		const { editor, blockId, scheduler, controller, measured } = fixture;
		controller.registerContributor(focusCaretContributor());
		editor.selectText(blockId, 2, 2, { origin: "keyboard" });
		flushFrame();
		const before = { ...measured };

		void scheduler.read(() => {});
		flushFrame();
		expect(measured).toEqual(before);
		expect(scheduler.diagnostics.paintCount).toBeGreaterThan(0);
	});

	it("SCH: an editor with no overlay contributor paints an empty layer and requests no flush on field changes", () => {
		fixture = createOverlayFixture();
		const { scheduler, controller, measured } = fixture;
		flushFrame();
		const flushes = scheduler.diagnostics.flushCount;
		fixture.setField({ isFocused: false });
		fixture.setField({ isComposing: true });
		fixture.reader.bumpScrollGeneration();
		expect(pendingFrames()).toBe(0);
		expect(scheduler.diagnostics.flushCount).toBe(flushes);
		expect(controller.layer.childElementCount).toBe(0);
		expect(measured).toEqual({ caret: 0, block: 0 });
	});
});
