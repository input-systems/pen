// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionState } from "@input/pen-types";
import { getRootGeometry } from "../geometry/rootGeometry";
import { collapsedRect, singleRunLineBox } from "../geometry/types";
import { resolveSelectionRect } from "../utils/selectionPlacement";

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

function textSelection(
	isCollapsed = false,
): Extract<SelectionState, { type: "text" }> {
	return {
		type: "text",
		anchor: { blockId: "p1", offset: 0 },
		focus: { blockId: "p1", offset: isCollapsed ? 0 : 4 },
	};
}

describe("resolveSelectionRect", () => {
	beforeEach(() => {
		installMockRaf();
	});

	afterEach(() => {
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	it("unions rangeRects through measureNow when idle", () => {
		const root = document.createElement("div");
		const range = collapsedRect(10, 20, 16);
		const rangeWithWidth = { ...range, width: 40, right: 50 };
		const host = getRootGeometry(root, {
			observeResize: false,
			observeFonts: false,
			measure: {
				rangeRects: () => [rangeWithWidth],
			},
		});

		const rect = resolveSelectionRect(root, textSelection());

		expect(rect?.left).toBe(10);
		expect(rect?.width).toBe(40);
		expect(host.scheduler.diagnostics.measureNowCount).toBe(1);
	});

	it("reads rangeRects in the scheduler read phase without measureNow", async () => {
		const root = document.createElement("div");
		const rangeWithWidth = {
			...collapsedRect(8, 12, 10),
			width: 24,
			right: 32,
		};
		const host = getRootGeometry(root, {
			observeResize: false,
			observeFonts: false,
			measure: {
				rangeRects: () => [rangeWithWidth],
			},
		});

		const seen: { rect: DOMRect | null } = { rect: null };
		const pending = host.scheduler.read(() => {
			expect(host.scheduler.phase).toBe("read");
			seen.rect = resolveSelectionRect(root, textSelection());
		});
		flushFrame();
		await pending;

		expect(seen.rect?.left).toBe(8);
		expect(host.scheduler.diagnostics.measureNowCount).toBe(0);
	});

	it("measures a spanning selection per block instead of the block border boxes", () => {
		const root = document.createElement("div");
		const lineHeight = 16;
		const inkLeft = 100;
		// full-width column box the browser reports for a fully covered block
		const columnBox = {
			...collapsedRect(0, 0, lineHeight),
			width: 800,
			right: 800,
		};
		const measuredRanges: Array<{
			blockId: string;
			from: number;
			to: number;
		}> = [];
		getRootGeometry(root, {
			observeResize: false,
			observeFonts: false,
			measure: {
				blockIds: () => ["p1", "p2", "p3", "p4"],
				lineBoxes: (blockId) => [
					singleRunLineBox(
						{
							...collapsedRect(inkLeft, 0, lineHeight),
							width: 200,
							right: inkLeft + 200,
						},
						0,
						blockId === "p3" ? 0 : 10,
					),
				],
				rangeRects: ({ anchor, focus }) => {
					if (anchor.blockId !== focus.blockId) {
						return [columnBox];
					}
					measuredRanges.push({
						blockId: anchor.blockId,
						from: anchor.offset,
						to: focus.offset,
					});
					const top = Number(anchor.blockId.slice(1)) * lineHeight;
					return [
						{
							...collapsedRect(
								inkLeft + anchor.offset * 8,
								top,
								lineHeight,
							),
							width: (focus.offset - anchor.offset) * 8,
							right: inkLeft + focus.offset * 8,
						},
					];
				},
			},
		});

		const rect = resolveSelectionRect(root, {
			type: "text",
			anchor: { blockId: "p4", offset: 6 },
			focus: { blockId: "p1", offset: 4 },
		});

		expect(measuredRanges).toEqual([
			{ blockId: "p1", from: 4, to: 10 },
			{ blockId: "p2", from: 0, to: 10 },
			{ blockId: "p4", from: 0, to: 6 },
		]);
		expect(rect?.left).toBe(inkLeft);
		expect(rect?.right).toBe(inkLeft + 80);
		expect(rect?.top).toBe(lineHeight);
		expect(rect?.bottom).toBe(5 * lineHeight);
	});

	it("returns null for collapsed text selections without measuring", () => {
		const root = document.createElement("div");
		const host = getRootGeometry(root, {
			observeResize: false,
			observeFonts: false,
			measure: {
				rangeRects: () => {
					throw new Error("should not measure collapsed selections");
				},
			},
		});

		const rect = resolveSelectionRect(root, textSelection(true));

		expect(rect).toBeNull();
		expect(host.scheduler.diagnostics.measureNowCount).toBe(0);
	});
});
