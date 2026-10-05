import type { DocumentOp } from "@input/pen-types";
import { expect, test, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../src/domGeometry";
import { disableEditContext } from "../suites/ime/compose";
import { twoEditorScenario, type EditorPeer, type TwoEditorApi } from "../src/twoEditorScenario";
import { readModelBlockText } from "../suites/specHelpers";

/**
 * W5.R10: two real editors on two pages, every update through a counted
 * relay. Latency is "held for N steps", never a clock (CH8).
 */

const PEER_A_USER_ID = "conformance-peer-a";

async function expectSelection(peer: EditorPeer, expected: Record<string, unknown>): Promise<void> {
	await expect
		.poll(() => peer.page.evaluate(() => window.__penConformance.selection))
		.toMatchObject(expected);
}

async function clickAt(peer: EditorPeer, blockId: string, offset: number): Promise<void> {
	const point = await getInlineOffsetPoint(peer.page, { blockId, offset });
	await peer.page.mouse.click(point.x, point.y);
	await expectSelection(peer, { type: "text", focus: { blockId, offset } });
}

async function applyOn(peer: EditorPeer, ops: readonly DocumentOp[]): Promise<void> {
	await peer.page.evaluate((list) => window.__penConformance.apply(list), ops);
}

async function blockOrder(page: Page): Promise<string[]> {
	return page.evaluate(() => [...window.__penConformance.documentSnapshot().blockOrder]);
}

async function renderedBlockIds(page: Page): Promise<(string | null)[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll("[data-pen-editor-root] [data-block-id]")].map((element) =>
			element.getAttribute("data-block-id"),
		),
	);
}

/** The left edge of the native caret on `page`, in viewport px. */
async function nativeCaretLeft(page: Page): Promise<number> {
	return page.evaluate(() => {
		const range = document.getSelection()?.getRangeAt(0);
		if (!range) throw new Error("no native caret");
		return range.getBoundingClientRect().left;
	});
}

twoEditorScenario(
	"COL1 S2: concurrent typing in two editors converges and holds S2 on both pages under held and reversed delivery",
	async ({ a, b, relay, standing, converge }) => {
		await clickAt(a, "hello-p1", 5);
		await clickAt(b, "hello-p1", 11);
		relay.hold();
		for (const char of "abc") {
			await a.page.keyboard.type(char);
			await b.page.keyboard.type(char.toUpperCase());
			await relay.pump();
			relay.queue.step();
			await standing();
		}
		expect(relay.queue.held("a"), "b's three keystrokes are held for a").toBeGreaterThan(0);
		expect(relay.queue.held("b"), "a's three keystrokes are held for b").toBeGreaterThan(0);
		await relay.release({ order: "reverse" });
		await standing();
		await converge();
		expect(await readModelBlockText(a.page, "hello-p1")).toBe("Helloabc worldABC");
		// Each local caret stays after its own typing on both pages.
		await expectSelection(a, { focus: { blockId: "hello-p1", offset: 8 } });
		await expectSelection(b, { focus: { blockId: "hello-p1", offset: 17 } });
	},
);

twoEditorScenario(
	"AN3 OV1: a remote caret paints at the peer's focus",
	async ({ a, b, relay, standing }) => {
		await clickAt(a, "hello-p1", 5);
		await clickAt(b, "hello-p1", 0);
		const caret = b.page.locator(
			`[data-pen-overlay-layer] [data-pen-multiplayer-caret][data-user-id="${PEER_A_USER_ID}"]`,
		);
		await expect
			.poll(async () => {
				await relay.pumpAwareness();
				return caret.count();
			})
			.toBe(1);
		await expect(caret).toHaveAttribute("data-block-id", "hello-p1");
		// Both pages lay out the same document in the same viewport.
		const expectedLeft = await nativeCaretLeft(a.page);
		const painted = await caret.boundingBox();
		expect(painted, "the remote caret has a box").not.toBeNull();
		expect(Math.abs(painted!.x - expectedLeft)).toBeLessThanOrEqual(1);
		await standing();
	},
);

async function imeLeg({ a, b, relay, standing, converge }: TwoEditorApi): Promise<void> {
	test.skip(test.info().project.name !== "chromium", "CDP IME is Chromium-only");
	await clickAt(a, "hello-p1", 11);
	await clickAt(b, "hello-p1", 0);
	relay.hold();
	const cdp = await a.page.context().newCDPSession(a.page);
	await cdp.send("Input.imeSetComposition", {
		text: "か",
		selectionStart: 1,
		selectionEnd: 1,
	});
	await b.page.keyboard.type("X");
	expect(await relay.release({ to: "a" }), "b's insert reaches a mid-composition").toBeGreaterThan(0);
	await cdp.send("Input.insertText", { text: "漢" });
	await standing();
	await converge();
	expect(await readModelBlockText(a.page, "hello-p1")).toBe("XHello world漢");
}

for (const backend of ["EditContext", "contenteditable"]) {
	twoEditorScenario(
		`C2 S2: a remote insert held across a Chromium IME composition converges after compositionend (${backend})`,
		imeLeg,
		backend === "EditContext" ? undefined : { initScript: disableEditContext },
	);
}

twoEditorScenario(
	"A5 AN14 S2: remote split, move, and delete around the local caret keep it anchored",
	async ({ a, b, relay, standing, converge }) => {
		await clickAt(a, "two-p2", 6);
		const steps: DocumentOp[][] = [
			// Split two-p1 after "Alpha " on b: the tail moves into a new block.
			[
				{
					type: "insert-block",
					blockId: "two-p1-tail",
					blockType: "paragraph",
					props: {},
					position: { after: "two-p1" },
				},
				{ type: "splice-text", blockId: "two-p1-tail", from: 0, to: 0, insert: "bravo charlie" },
				{ type: "splice-text", blockId: "two-p1", from: 6, to: 19, insert: "" },
			],
			[{ type: "move-block", blockId: "two-p2", position: "first" }],
			[{ type: "delete-block", blockId: "two-p1-tail" }],
		];
		for (const ops of steps) {
			await applyOn(b, ops);
			await relay.pump();
			await standing();
		}
		await converge();
		expect(await blockOrder(a.page)).toEqual(["two-p2", "two-p1"]);
		const caret = { blockId: "two-p2", offset: 6 };
		await expectSelection(a, { type: "text", anchor: caret, focus: caret });
		// The anchored caret still types where it sits.
		await a.page.keyboard.type("Z");
		await converge();
		expect(await readModelBlockText(b.page, "two-p2")).toBe("Delta Zecho foxtrot");
	},
	{ fixture: "two-paragraph" },
);

twoEditorScenario(
	"COL4: a concurrent delete and move render on both pages without a dangling block",
	async ({ a, b, relay, converge }) => {
		relay.hold();
		await applyOn(a, [{ type: "delete-block", blockId: "two-p1" }]);
		await applyOn(b, [{ type: "move-block", blockId: "two-p1", position: "last" }]);
		await relay.release({ order: "reverse" });
		await relay.live();
		for (const peer of [a, b]) {
			expect(
				await renderedBlockIds(peer.page),
				`page ${peer.id}: the deletion wins and nothing renders for the dangling entry`,
			).toEqual(["two-p2"]);
		}
		// The next local structural pass removes the entry, and the repair converges.
		await applyOn(a, [
			{
				type: "insert-block",
				blockId: "two-p3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		await converge();
		for (const peer of [a, b]) {
			expect(await blockOrder(peer.page), `page ${peer.id} order`).toEqual(["two-p2", "two-p3"]);
			expect(await renderedBlockIds(peer.page)).toEqual(["two-p2", "two-p3"]);
		}
	},
	{ fixture: "two-paragraph" },
);
