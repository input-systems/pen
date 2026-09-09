import type { DocumentOp } from "@input/pen-types";
import { expect } from "@playwright/test";
import { LOCAL_FIXTURES } from "../fixtures/catalog";
import { caretCacheHolds } from "../harness/src/geometryCompare";
import { scenario } from "../src/scenario";
import type { GeometryBlockInfo, GeometryCaretCompareResult } from "../src/types";
import { sampleCaretPoints, G5_TAIL_BLOCK } from "../src/g5Geometry";

const G5_TAIL_TEXT =
	LOCAL_FIXTURES["g5-geometry"].find((block) => block.id === G5_TAIL_BLOCK)
		?.content ?? "";

const SCROLL_DISTANCE = 250;
const SCROLL_FILLER_BLOCKS = 30;
const ROOT_SHIFT_PX = 50;

type CommitStep = {
	name: string;
	ops: (blocks: readonly GeometryBlockInfo[]) => DocumentOp[];
};

const COMMIT_STEPS: readonly CommitStep[] = [
	{
		name: "insert-text at the start of the first block",
		ops: (blocks) => {
			const block = blocks[0];
			if (!block) return [];
			return [{ type: "splice-text", blockId: block.id, from: 0,
				to: 0,
				insert: "!" }];
		},
	},
	{
		name: "insert-text at the end of the first block",
		ops: (blocks) => {
			const block = blocks[0];
			if (!block) return [];
			return [
				{
					type: "splice-text",
					blockId: block.id,
					from: block.length,
				to: block.length,
				insert: "Z",
				},
			];
		},
	},
	{
		name: "delete-text from the middle of the first block",
		ops: (blocks) => {
			const block = blocks[0];
			if (!block || block.length < 2) return [];
			return [
				{
					type: "splice-text",
					blockId: block.id,
					from: 1,
				to: 1 + 1,
				insert: "",
				},
			];
		},
	},
	{
		name: "replace-text in the first block",
		ops: (blocks) => {
			const block = blocks[0];
			if (!block || block.length < 2) return [];
			return [
				{
					type: "splice-text",
					blockId: block.id,
					from: 0,
				to: 0 + 1,
					insert: "Q",
				},
			];
		},
	},
	{
		name: "insert-text long enough to grow the first block",
		ops: (blocks) => {
			const block = blocks[0];
			if (!block) return [];
			return [
				{
					type: "splice-text",
					blockId: block.id,
					from: block.length,
				to: block.length,
				insert: " GROW-THE-BLOCK-WITH-A-LONG-RUN-OF-CHARACTERS",
				},
			];
		},
	},
	{
		name: "insert-inline-node mention in the atoms block",
		ops: (blocks) => {
			const block = blocks.find((entry) => entry.id === "g5-atoms");
			if (!block) return [];
			const offset = Math.min(5, block.length);
			return [
				{
					type: "splice-text",
					blockId: block.id,
					from: offset,
					to: offset,
					insert: {
						nodeType: "mention",
						props: { id: "user-ada", label: "Ada" },
					},
				},
			];
		},
	},
	{
		name: "insert-block after the last block",
		ops: (blocks) => {
			const last = blocks[blocks.length - 1];
			if (!last) return [];
			return [
				{
					type: "insert-block",
					blockId: "g2-after",
					blockType: "paragraph",
					props: {},
					position: { after: last.id },
				},
				{
					type: "splice-text",
					blockId: "g2-after",
					from: 0,
				to: 0,
				insert: "After",
				},
			];
		},
	},
	{
		name: "insert-block before the first block",
		ops: (blocks) => {
			const first = blocks[0];
			if (!first) return [];
			return [
				{
					type: "insert-block",
					blockId: "g2-before",
					blockType: "paragraph",
					props: {},
					position: { before: first.id },
				},
				{
					type: "splice-text",
					blockId: "g2-before",
					from: 0,
				to: 0,
				insert: "Before",
				},
			];
		},
	},
	{
		name: "split-block the tail paragraph",
		ops: (blocks) => {
			const tail = blocks.find((entry) => entry.id === G5_TAIL_BLOCK);
			if (!tail || tail.length < 4) return [];
			const offset = 5;
			const tailText = G5_TAIL_TEXT.slice(offset);
			return [
				{
					type: "insert-block",
					blockId: "g2-split",
					blockType: "paragraph",
					props: {},
					position: { after: tail.id },
				},
				{
					type: "splice-text",
					blockId: tail.id,
					from: offset,
					to: tail.length,
					insert: "",
				},
				{
					type: "splice-text",
					blockId: "g2-split",
					from: 0,
					to: 0,
					insert: tailText,
				},
			];
		},
	},
	{
		name: "delete-block the inserted after block",
		ops: (blocks) => {
			if (!blocks.some((entry) => entry.id === "g2-after")) return [];
			return [{ type: "delete-block", blockId: "g2-after" }];
		},
	},
];

function formatCacheFailure(
	result: GeometryCaretCompareResult,
	step: string,
): string {
	const lines = result.compares
		.filter(
			(entry) =>
				entry.stale || entry.cached == null || entry.fromScratch == null,
		)
		.map((entry) => {
			const cached = JSON.stringify(entry.cached);
			const fresh = JSON.stringify(entry.fromScratch);
			return `${entry.point.blockId}:${entry.point.offset}:${entry.affinity} cached=${cached} fresh=${fresh}`;
		});
	return `G2 ${step}: ${result.staleCount} stale, ${result.missingCount} missing caretRect(s)\n${lines.join("\n")}`;
}

scenario(
	"G2 SCH1: after any commit sequence caretRect equals a from-scratch measurement",
	async (s, page) => {
		await s.load("g5-geometry");

		const failures: string[] = [];

		async function assertCachedEqualsFresh(step: string): Promise<void> {
			const blocks = await s.geometry.blocks();
			const points = sampleCaretPoints(blocks);
			expect(points.length).toBeGreaterThan(0);
			await s.geometry.warm(points);
			const result = await s.geometry.compare(points);
			if (!caretCacheHolds(result)) {
				failures.push(formatCacheFailure(result, step));
			}
		}

		await assertCachedEqualsFresh("initial document");

		for (const step of COMMIT_STEPS) {
			const blocks = await s.geometry.blocks();
			const ops = step.ops(blocks);
			if (ops.length === 0) {
				continue;
			}

			const points = sampleCaretPoints(blocks);
			await s.geometry.warm(points);
			await s.apply(ops);
			await expect
				.poll(async () => {
					return page.evaluate(() => {
						const ids = window.__penConformance.blockIds;
						return ids.every(
							(id) => document.querySelector(`[data-block-id="${id}"]`) != null,
						);
					});
				})
				.toBe(true);

			const mention = ops.some((op) => {
				if (op.type !== "splice-text") {
					return false;
				}
				const insert = op.insert;
				return (
					typeof insert === "object" &&
					insert !== null &&
					!Array.isArray(insert) &&
					"nodeType" in insert &&
					insert.nodeType === "mention"
				);
			});
			if (mention) {
				await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();
			}
			const inserted = ops.find((op) => op.type === "insert-block");
			if (inserted && inserted.type === "insert-block") {
				await expect(
					page.locator(`[data-block-id="${inserted.blockId}"]`),
				).toBeVisible();
			}
			const deleted = ops.find((op) => op.type === "delete-block");
			if (deleted && deleted.type === "delete-block") {
				await expect(
					page.locator(`[data-block-id="${deleted.blockId}"]`),
				).toHaveCount(0);
			}

			const after = await s.geometry.blocks();
			const result = await s.geometry.compare(sampleCaretPoints(after));
			if (!caretCacheHolds(result)) {
				failures.push(formatCacheFailure(result, step.name));
			}
		}

		const beforeRemote = sampleCaretPoints(await s.geometry.blocks());
		await s.geometry.warm(beforeRemote);
		await s.remote.splice({
			block: 0,
			from: 0,
			to: 0,
			insert: "R",
		});
		await expect(page.locator("[data-pen-inline-content]").first()).toBeVisible();
		const afterRemote = await s.geometry.compare(
			sampleCaretPoints(await s.geometry.blocks()),
		);
		if (!caretCacheHolds(afterRemote)) {
			failures.push(formatCacheFailure(afterRemote, "remote splice"));
		}

		expect(
			failures,
			[
				"G2: cached caretRect went stale or missing after a commit that moved unedited blocks (invalidation is summary-block-only; neighbors keep the old Y; both-null is missing, not equal).",
				...failures,
			].join("\n\n"),
		).toEqual([]);
	},
);

function scrollFillerOps(tailBlockId: string): DocumentOp[] {
	const ops: DocumentOp[] = [];
	let previous = tailBlockId;
	for (let index = 0; index < SCROLL_FILLER_BLOCKS; index++) {
		const blockId = `g2-scroll-${index}`;
		ops.push({
			type: "insert-block",
			blockId,
			blockType: "paragraph",
			props: {},
			position: { after: previous },
		});
		ops.push({
			type: "splice-text",
			blockId,
			from: 0,
			to: 0,
			insert: `Scroll filler ${index}`,
		});
		previous = blockId;
	}
	return ops;
}

scenario(
	"G2: after a scroll that moves the root caretRect equals a from-scratch measurement",
	async (s, page) => {
		await s.load("g5-geometry");

		// caretRect returns viewport coordinates, so a scroll moves every
		// cached rect. The fixture is shorter than any viewport, so grow it
		// until the page has somewhere to scroll to.
		const blocks = await s.geometry.blocks();
		const tail = blocks[blocks.length - 1];
		expect(tail).toBeDefined();
		await s.apply(scrollFillerOps(tail!.id));
		await expect
			.poll(() =>
				page.evaluate(() => {
					const scroller = document.scrollingElement;
					return scroller
						? scroller.scrollHeight - scroller.clientHeight
						: 0;
				}),
			)
			.toBeGreaterThan(SCROLL_DISTANCE);

		const points = sampleCaretPoints(await s.geometry.blocks());
		expect(points.length).toBeGreaterThan(0);
		await s.geometry.warm(points);

		const scrollTop = await page.evaluate(async (distance) => {
			const scroller = document.scrollingElement;
			if (!scroller) {
				return -1;
			}
			scroller.scrollTop = distance;
			await new Promise((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(resolve));
			});
			return scroller.scrollTop;
		}, SCROLL_DISTANCE);
		expect(scrollTop).toBe(SCROLL_DISTANCE);

		const result = await s.geometry.compare(points);
		expect(
			caretCacheHolds(result),
			formatCacheFailure(result, "scroll"),
		).toBe(true);
	},
);

scenario(
	"G2: after a layout shift that moves the root without resizing it caretRect equals a from-scratch measurement",
	async (s, page) => {
		await s.load("g5-geometry");

		const points = sampleCaretPoints(await s.geometry.blocks());
		expect(points.length).toBeGreaterThan(0);
		await s.geometry.warm(points);

		// a window resize re-centring a max-width column moves the root but
		// keeps its size, so neither the ResizeObserver nor the scroll listener
		// sees it; the shift below is that case without the window
		const shift = await page.evaluate(async (distance) => {
			const root = document.querySelector<HTMLElement>(
				"[data-pen-editor-root]",
			);
			if (!root) {
				return null;
			}
			const before = root.getBoundingClientRect();
			root.style.position = "relative";
			root.style.left = `${distance}px`;
			await new Promise((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(resolve));
			});
			const after = root.getBoundingClientRect();
			return {
				dx: after.left - before.left,
				dw: after.width - before.width,
				dh: after.height - before.height,
			};
		}, ROOT_SHIFT_PX);
		expect(shift).toEqual({ dx: ROOT_SHIFT_PX, dw: 0, dh: 0 });

		const result = await s.geometry.compare(points);
		expect(
			caretCacheHolds(result),
			formatCacheFailure(result, "root moved without resize"),
		).toBe(true);
	},
);
