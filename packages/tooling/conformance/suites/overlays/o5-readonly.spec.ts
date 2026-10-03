import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { itemsOfKind, readSettledLayer } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";

const HELLO_ID = "hello-p1";

async function nativeSelection(page: Page): Promise<{ rangeCount: number; text: string }> {
	return page.evaluate(() => {
		const selection = window.getSelection();
		return {
			rangeCount: selection?.rangeCount ?? 0,
			text: selection?.toString() ?? "",
		};
	});
}

scenario(
	"O5: a read-only editor draws no overlay caret beside an atom, and copy still works",
	async (s, page) => {
		await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
		await s.load("hello-world");
		await s.apply([
			{
				type: "splice-text",
				blockId: HELLO_ID,
				from: 5,
				to: 5,
				insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
			},
		]);
		await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();
		const point = await getInlineOffsetPoint(page, { blockId: HELLO_ID, offset: 5 });
		await page.mouse.click(point.x, point.y);

		const layer = await readSettledLayer(page);
		const native = await nativeSelection(page);
		await test.info().attach("o5-click", {
			body: JSON.stringify({ layer, native }, null, 2),
			contentType: "application/json",
		});
		expect(
			itemsOfKind(layer, "caret"),
			formatCheckReport(
				"O5: no overlay caret of any role in a read-only editor",
				itemsOfKind(layer, "caret").length === 0 ? "passed" : "failed",
			),
		).toEqual([]);
		expect(layer.caretColor, "O5: nothing hides the native caret").not.toBe("transparent");
		expect(native.rangeCount, "O5: a native selection exists").toBeGreaterThan(0);

		await s.mouse.dragText({
			from: { blockId: HELLO_ID, offset: 0 },
			to: { blockId: HELLO_ID, offset: 4 },
		});
		await expect.poll(async () => (await nativeSelection(page)).text).toBe("Hell");
		await page.keyboard.press("ControlOrMeta+c");
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("Hell");
		expect(itemsOfKind(await readSettledLayer(page), "caret")).toEqual([]);
	},
	{ url: "/?readonly=1" },
);

test.skip(
	({ browserName }) => browserName !== "chromium",
	"clipboard-read permission is Chromium-only in Playwright",
);
