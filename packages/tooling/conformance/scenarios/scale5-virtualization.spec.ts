import { expect } from "@playwright/test";
import {
	WINDOWED_LARGE_BLOCK_COUNT,
	WINDOWED_WINDOW_SIZE,
	windowedBlockId,
} from "../fixtures/catalog";
import { scenario } from "../src/scenario";

scenario(
	"SCALE5 P4: a selection outside a window that ignores reveal reports selection-target-unmounted once and projects on remount",
	async (s, page) => {
		await s.load("windowed-large");
		await expect(page.locator("[data-pen-windowed]")).toHaveAttribute(
			"data-window-size",
			String(WINDOWED_WINDOW_SIZE),
		);
		await expect(page.locator("[data-pen-editor-block]")).toHaveCount(
			WINDOWED_WINDOW_SIZE,
		);
		await expect(
			page.locator(`[data-block-id="${windowedBlockId(0)}"]`),
		).toBeVisible();
		await expect(
			page.locator(
				`[data-block-id="${windowedBlockId(WINDOWED_WINDOW_SIZE)}"]`,
			),
		).toHaveCount(0);

		await s.keyboard.type("!");
		await s.assert.textContains("!Window block 0");

		const scrolledStart = 24;
		await page.evaluate((start) => {
			window.__penConformance.setWindow(start);
		}, scrolledStart);
		await expect(page.locator("[data-pen-windowed]")).toHaveAttribute(
			"data-window-start",
			String(scrolledStart),
		);
		await expect(
			page.locator(`[data-block-id="${windowedBlockId(0)}"]`),
		).toHaveCount(0);
		await expect(
			page.locator(`[data-block-id="${windowedBlockId(scrolledStart)}"]`),
		).toBeVisible();

		await page
			.locator(
				`[data-block-id="${windowedBlockId(scrolledStart)}"] [data-pen-inline-content]`,
			)
			.click();
		await s.keyboard.type("?");
		await s.assert.textContains("?Window block 24");
		await s.assert.textContains("!Window block 0");

		// Scrolling win-0 out while it held the caret may already have parked
		// a projection on it (Firefox's reader sees the removed field's
		// selection collapse and reprojects). That report belongs to the
		// scroll, not to this park, so count from here.
		const unmountedBefore = await page.evaluate(
			() =>
				window.__penConformance.diagnostics.filter(
					(event) => event.code === "selection-target-unmounted",
				).length,
		);
		// Firefox may echo the live win-24 caret over this selectText.
		// Not a sentinel leak — applyDomTextSelection in
		// contenteditableBackend.ts writes the DOM caret back.
		await page.evaluate(() => {
			window.__penConformance.selectText(0, 0);
		});
		const afterOutside = await page.evaluate(() => {
			const mounted = [
				...document.querySelectorAll("[data-pen-editor-block]"),
			]
				.map((element) => element.getAttribute("data-block-id"))
				.filter((id): id is string => id != null);
			return {
				selection: window.__penConformance.selection,
				mounted,
				documentText: window.__penConformance.documentText,
				blockIds: window.__penConformance.blockIds,
				diagnostics: window.__penConformance.diagnostics.map(
					(event) => event.code,
				),
			};
		});
		expect(afterOutside.selection).toMatchObject({
			type: "text",
			anchor: { blockId: windowedBlockId(0), offset: 0 },
			focus: { blockId: windowedBlockId(0), offset: 0 },
		});
		expect(afterOutside.mounted).not.toContain(windowedBlockId(0));
		expect(afterOutside.mounted).toContain(windowedBlockId(scrolledStart));
		expect(afterOutside.documentText).toContain("!Window block 0");
		expect(afterOutside.documentText).toContain("?Window block 24");
		expect(afterOutside.blockIds).toHaveLength(WINDOWED_LARGE_BLOCK_COUNT);
		// W3.R9: no mount requester is installed, so the flush after the park
		// reports the unmounted target once, without a mount request.
		await expect
			.poll(() =>
				page.evaluate(
					(before) =>
						window.__penConformance.diagnostics
							.filter(
								(event) =>
									event.code === "selection-target-unmounted",
							)
							.slice(before)
							.map((event) => event.details ?? {}),
					unmountedBefore,
				),
			)
			.toEqual([
				expect.objectContaining({
					blockId: windowedBlockId(0),
					mountRequested: false,
				}),
			]);

		await page.evaluate(() => {
			window.__penConformance.setWindow(0);
		});
		await expect(
			page.locator(`[data-block-id="${windowedBlockId(0)}"]`),
		).toBeVisible();
		// P4: the remounted block's ack projects the parked caret, no click.
		await expect
			.poll(async () => {
				const check = await page.evaluate(() =>
					window.__penConformance.domMatchesAuthority(),
				);
				return check.ok ? "ok" : (check.reason ?? "mismatch");
			})
			.toBe("ok");
		await s.assert.textContains("!Window block 0");
		await s.assert.textContains("?Window block 24");
		const remounted = await page.evaluate(() => ({
			blockIds: window.__penConformance.blockIds,
			diagnostics: window.__penConformance.diagnostics.map(
				(event) => event.code,
			),
		}));
		expect(remounted.blockIds).toHaveLength(WINDOWED_LARGE_BLOCK_COUNT);
		expect(
			remounted.diagnostics
				.filter((code) => code === "selection-target-unmounted")
				.slice(unmountedBefore),
		).toHaveLength(1);
	},
);
