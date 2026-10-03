import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";

const CUSTOM_CARET = "/?customCaret=1";

type CaretSnapshot = {
	layerMounted: boolean;
	caretVisible: boolean;
	caretCount: number;
	inLayer: boolean;
	blockId: string | null;
	offset: string | null;
	affinity: string | null;
	caretColor: string | null;
	width: number;
	height: number;
};

async function clickOffset(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId, offset });
	await page.mouse.click(point.x, point.y);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const selection = window.__penConformance.selection;
				return selection?.type === "text" &&
					window.__penConformance.isCollapsed()
					? `${selection.focus.blockId}:${selection.focus.offset}`
					: "not-collapsed";
			}),
		)
		.toBe(`${blockId}:${offset}`);
}

async function readCaret(page: Page): Promise<CaretSnapshot> {
	return page.evaluate(() => {
		const layer = document.querySelector("[data-pen-overlay-layer]");
		const carets = document.querySelectorAll("[data-pen-editor-caret]");
		const caret = carets[0];
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface]",
		);
		const box =
			caret instanceof HTMLElement ? caret.getBoundingClientRect() : null;
		return {
			layerMounted: layer instanceof HTMLElement,
			caretVisible:
				layer instanceof HTMLElement && layer.hasAttribute("data-caret-visible"),
			caretCount: carets.length,
			inLayer: caret instanceof HTMLElement && caret.parentElement === layer,
			blockId: caret?.getAttribute("data-block-id") ?? null,
			offset: caret?.getAttribute("data-offset") ?? null,
			affinity: caret?.getAttribute("data-affinity") ?? null,
			caretColor:
				surface instanceof HTMLElement ? surface.style.caretColor : null,
			width: box?.width ?? 0,
			height: box?.height ?? 0,
		};
	});
}

scenario(
	"O: customCaret paints an ordinary collapsed caret and hides the native caret",
	async (s, page) => {
		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 2);
		await expect
			.poll(async () => (await readCaret(page)).caretCount)
			.toBe(1);
		const caret = await readCaret(page);
		await test.info().attach("custom-caret", {
			body: JSON.stringify({ caret }, null, 2),
			contentType: "application/json",
		});

		expect(
			caret.layerMounted,
			formatCheckReport("O: pen-dom mounted the overlay layer", caret.layerMounted ? "passed" : "failed"),
		).toBe(true);
		expect(
			caret.inLayer,
			formatCheckReport("O: the caret is painted inside the layer", caret.inLayer ? "passed" : "failed"),
		).toBe(true);
		expect(caret.blockId).toBe("hello-p1");
		expect(caret.offset).toBe("2");
		// The serialized selection carries no affinity; the record's own is
		// pinned headlessly (selectionOverlay G3). Here: the caret names one.
		expect(["upstream", "downstream"]).toContain(caret.affinity);
		expect(
			caret.caretVisible,
			formatCheckReport("O: data-caret-visible on the layer", caret.caretVisible ? "passed" : "failed"),
		).toBe(true);
		expect(
			caret.caretColor,
			formatCheckReport(
				"O: native caret-color is transparent",
				caret.caretColor === "transparent" ? "passed" : "failed",
				`caretColor=${caret.caretColor}`,
			),
		).toBe("transparent");
		expect(caret.width).toBeGreaterThan(0);
		expect(caret.height).toBeGreaterThan(0);
	},
	{ url: CUSTOM_CARET },
);

scenario(
	"O: customCaret hands the caret back to the native caret for a range",
	async (s, page) => {
		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 1);
		await expect.poll(async () => (await readCaret(page)).caretCount).toBe(1);
		await page.keyboard.press("Shift+ArrowRight");
		await expect
			.poll(() => page.evaluate(() => window.__penConformance.isCollapsed()))
			.toBe(false);
		await expect.poll(async () => (await readCaret(page)).caretCount).toBe(0);
		const caret = await readCaret(page);
		expect(caret.caretVisible).toBe(false);
		expect(caret.caretColor).not.toBe("transparent");
	},
	{ url: CUSTOM_CARET },
);
