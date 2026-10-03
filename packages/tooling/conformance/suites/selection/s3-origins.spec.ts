import { expect, test, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";

/**
 * S3: every accepted authority write carries the origin of its real source.
 * Gestures write `pointer`, keymap commands and keyboard-initiated paste
 * write `keyboard`, and the host API stays `programmatic` (W3.R11, W3.G7).
 */

const BLOCK_ID = "hello-p1";

async function recordOrigin(page: Page): Promise<string | null> {
	return page.evaluate(
		() => window.__penConformance.selectionRecord?.origin ?? null,
	);
}

async function clickOffset(page: Page, offset: number): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId: BLOCK_ID, offset });
	await page.mouse.click(point.x, point.y);
}

scenario("S3: a click writes pointer", async (s, page) => {
	await s.load("hello-world");
	await s.selectText(0, 0);
	await clickOffset(page, 3);
	await expect.poll(() => recordOrigin(page)).toBe("pointer");
	await s.assert.domMatchesAuthority();
});

scenario("S3: a drag writes pointer", async (s, page) => {
	await s.load("hello-world");
	const from = await getInlineOffsetPoint(page, {
		blockId: BLOCK_ID,
		offset: 1,
	});
	const to = await getInlineOffsetPoint(page, { blockId: BLOCK_ID, offset: 8 });
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const record = window.__penConformance.selectionRecord;
				if (record?.state?.type !== "text") return null;
				return {
					origin: record.origin,
					collapsed:
						record.state.anchor.offset === record.state.focus.offset,
				};
			}),
		)
		.toEqual({ origin: "pointer", collapsed: false });
	await s.assert.domMatchesAuthority();
});

scenario(
	"S3: ArrowRight across an inline atom writes keyboard",
	async (s, page) => {
		await s.load("hello-world");
		await s.apply([
			{
				type: "splice-text",
				blockId: BLOCK_ID,
				from: 5,
				to: 5,
				insert: {
					nodeType: "mention",
					props: { id: "user-ada", label: "Ada" },
				},
			},
		]);
		await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();
		await clickOffset(page, 2);
		await expect.poll(() => recordOrigin(page)).toBe("pointer");
		await s.selectText(0, 5);
		await s.keyboard.press("ArrowRight");
		await expect
			.poll(() =>
				page.evaluate(() => {
					const record = window.__penConformance.selectionRecord;
					if (record?.state?.type !== "text") return null;
					return { origin: record.origin, offset: record.state.focus.offset };
				}),
			)
			.toEqual({ origin: "keyboard", offset: 6 });
		await s.assert.domMatchesAuthority();
	},
);

scenario("S3: Mod-v paste caret writes keyboard", async (s, page) => {
	// Harness limit: only Chromium implements the clipboard permissions.
	test.skip(
		test.info().project.name !== "chromium",
		"grantPermissions(clipboard-read) is Chromium-only in Playwright",
	);
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	// Into an empty block that the paste replaces, so the caret write lands
	// where no mapped caret is. A paste whose caret equals the A5-mapped caret
	// writes nothing, and that record stays `mapped` with a `user` commit.
	await s.load("empty");
	await page
		.locator('[data-block-id="empty-p1"] [data-pen-inline-content]')
		.click();
	await expect.poll(() => recordOrigin(page)).toBe("pointer");
	await page.evaluate(async () => {
		await navigator.clipboard.writeText("XY\n\nZW");
	});
	const modifier = process.platform === "darwin" ? "Meta" : "Control";
	await page.keyboard.press(`${modifier}+v`);
	await s.assert.textContains("ZW");
	await expect.poll(() => recordOrigin(page)).toBe("keyboard");
	await s.assert.domMatchesAuthority();
});

scenario("S3: a host selectText stays programmatic", async (s, page) => {
	await s.load("hello-world");
	await clickOffset(page, 3);
	await expect.poll(() => recordOrigin(page)).toBe("pointer");
	await s.selectText(0, 7);
	await expect.poll(() => recordOrigin(page)).toBe("programmatic");
	await s.assert.domMatchesAuthority();
});
