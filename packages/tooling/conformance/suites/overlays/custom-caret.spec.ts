import { expect, type Page } from "@playwright/test";
import { expectCheck } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachJson, clickOffsetAndAwaitCaret } from "../specHelpers";

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

/** Read the caret once the scheduler has flushed (OV4), so the paint is current. */
async function readSettledCaret(page: Page): Promise<CaretSnapshot> {
	const check = await page.evaluate(() =>
		window.__penConformance.overlayMatchesAuthority(),
	);
	expect(check.kind, `OV4 before reading the caret: ${check.reason}`).toBe(
		"held",
	);
	return readCaret(page);
}

scenario(
	"O: customCaret paints an ordinary collapsed caret and hides the native caret",
	async (s, page) => {
		await s.load("hello-world");
		await clickOffsetAndAwaitCaret(page, "hello-p1", 2);
		// The load already painted a caret at the end of the line, so a caret
		// count proves nothing about the click; the overlay paints the new
		// record on the next scheduler flush (OV4), so wait for that flush.
		const caret = await readSettledCaret(page);
		expect(caret.caretCount).toBe(1);
		await attachJson("custom-caret", { caret });

		expectCheck("O: pen-dom mounted the overlay layer", caret.layerMounted);
		expectCheck("O: the caret is painted inside the layer", caret.inLayer);
		expect(caret.blockId).toBe("hello-p1");
		expect(caret.offset).toBe("2");
		// The serialized selection carries no affinity; the record's own is
		// pinned headlessly (selectionOverlay G3). Here: the caret names one.
		expect(["upstream", "downstream"]).toContain(caret.affinity);
		expectCheck("O: data-caret-visible on the layer", caret.caretVisible);
		expectCheck(
			"O: native caret-color is transparent",
			caret.caretColor === "transparent",
			`caretColor=${caret.caretColor}`,
		);
		expect(caret.width).toBeGreaterThan(0);
		expect(caret.height).toBeGreaterThan(0);
	},
	{ url: CUSTOM_CARET },
);

scenario(
	"O: customCaret hands the caret back to the native caret for a range",
	async (s, page) => {
		await s.load("hello-world");
		await clickOffsetAndAwaitCaret(page, "hello-p1", 1);
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
