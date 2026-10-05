import { expect, type Page } from "@playwright/test";
import { scenario } from "../../src/scenario";

/** Viewport point at the middle of the first block's second character. */
async function pointInFirstWord(page: Page): Promise<{ x: number; y: number }> {
	return page.evaluate(() => {
		const inline = document.querySelector("[data-pen-inline-content]")!;
		const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
		const text = walker.nextNode()!;
		const range = document.createRange();
		range.setStart(text, 1);
		range.setEnd(text, 2);
		const rect = range.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	});
}

async function expectDomMatchesAuthority(page: Page): Promise<void> {
	const check = await page.evaluate(() =>
		window.__penConformance.domMatchesAuthority(),
	);
	expect(check.ok, check.reason).toBe(true);
}

scenario(
	"R1 S2: a triple-click leaves the DOM equivalent to the authority",
	async (s, page) => {
		await s.load("hello-world");
		const point = await pointInFirstWord(page);
		await page.mouse.click(point.x, point.y, { clickCount: 3 });

		await expect
			.poll(async () => {
				const check = await page.evaluate(() =>
					window.__penConformance.domMatchesAuthority(),
				);
				return check.ok ? "ok" : (check.reason ?? "mismatch");
			})
			.toBe("ok");
	},
);

async function recordRange(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		const record = window.__penConformance.selectionRecord;
		const state = record?.state ?? null;
		if (state?.type !== "text") return null;
		return {
			origin: record?.origin,
			anchor: state.anchor.offset,
			focus: state.focus.offset,
		};
	});
}

scenario(
	"R1 S2: double-click and triple-click expansions are accepted inside the pointer window and the DOM matches each",
	async (s, page) => {
		await s.load("hello-world");
		const diagnosticsBefore = await page.evaluate(
			() => window.__penConformance.diagnostics.length,
		);
		const point = await pointInFirstWord(page);

		await page.mouse.dblclick(point.x, point.y);
		await expect
			.poll(() => recordRange(page))
			.toEqual({ origin: "pointer", anchor: 0, focus: 5 });
		await expectDomMatchesAuthority(page);

		await page.mouse.click(point.x, point.y, { clickCount: 3 });
		await expect
			.poll(() => recordRange(page))
			.toEqual({ origin: "pointer", anchor: 0, focus: "Hello world".length });

		await expectDomMatchesAuthority(page);
		const mismatches = await page.evaluate(
			(from) =>
				window.__penConformance.diagnostics
					.slice(from)
					.filter((entry) => entry.code === "selection-projection-mismatch"),
			diagnosticsBefore,
		);
		expect(mismatches).toEqual([]);
	},
);
