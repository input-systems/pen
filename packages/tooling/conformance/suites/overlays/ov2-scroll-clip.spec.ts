import { expect, type Page } from "@playwright/test";
import { expectCheck, readSettledLayer, remoteCarets } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachJson } from "../specHelpers";

const HELLO_ID = "hello-p1";
const REMOTE_OFFSET = 2;
const CHROME_HEIGHT = 300;
const SCROLLER_HEIGHT = 120;
const SCROLL_BY = 200;

/** The scroller: the editor root itself, or the harness container around it. */
const SCROLLER_SELECTOR = {
	root: "[data-pen-editor-root]",
	ancestor: "#root",
} as const;

type Scroller = keyof typeof SCROLLER_SELECTOR;

type ClipProbe = {
	itemBox: { top: number; bottom: number; left: number; right: number };
	scrollerTop: number;
	hit: "item" | "chrome" | "other";
	hitTag: string;
};

/**
 * App chrome above the editor (outside React), and a scroller that is either
 * the editor root itself or the harness container around it. Neither is
 * positioned by the host.
 */
async function arrange(page: Page, scroller: Scroller): Promise<void> {
	await page.evaluate(
		({ selector, chromeHeight, scrollerHeight }) => {
			const chrome = document.createElement("div");
			chrome.setAttribute("data-conformance-app-chrome", "");
			chrome.style.height = `${chromeHeight}px`;
			chrome.style.background = "#eee";
			const container = document.getElementById("root")!;
			document.body.insertBefore(chrome, container);
			const target = document.querySelector<HTMLElement>(selector)!;
			target.style.overflow = "auto";
			target.style.height = `${scrollerHeight}px`;
			// WCAG 2.1.1 (standing axe check): the editor's fields are not
			// focusable until one is edited, so the host's scroller takes focus.
			target.tabIndex = 0;
			// Tall content so the scroller can move the text out of view.
			document
				.querySelector<HTMLElement>("[data-pen-conformance-harness]")!
				.style.setProperty("padding-bottom", "800px");
		},
		{ selector: SCROLLER_SELECTOR[scroller], chromeHeight: CHROME_HEIGHT, scrollerHeight: SCROLLER_HEIGHT },
	);
}

async function scroll(page: Page, scroller: Scroller): Promise<void> {
	await page.evaluate(
		({ selector, by }) => {
			document.querySelector<HTMLElement>(selector)!.scrollTop = by;
			return new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			});
		},
		{ selector: SCROLLER_SELECTOR[scroller], by: SCROLL_BY },
	);
}

/** Hit-test the caret's centre with the caret made hit-testable: a clipped item is not hit. */
async function probeClip(page: Page, scroller: Scroller): Promise<ClipProbe> {
	return page.evaluate((selector) => {
		const item = document.querySelector<HTMLElement>(
			'[data-pen-overlay-layer] [data-pen-overlay-item="caret"]',
		)!;
		const target = document.querySelector<HTMLElement>(selector)!;
		const box = item.getBoundingClientRect();
		const previous = item.style.pointerEvents;
		item.style.pointerEvents = "auto";
		const hitElement = document.elementFromPoint(
			box.left + box.width / 2,
			box.top + Math.min(box.height / 2, 4),
		);
		item.style.pointerEvents = previous;
		const chrome = document.querySelector("[data-conformance-app-chrome]");
		return {
			itemBox: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
			scrollerTop: target.getBoundingClientRect().top,
			hit:
				hitElement !== null && item.contains(hitElement)
					? "item"
					: hitElement === chrome
						? "chrome"
						: "other",
			hitTag: hitElement?.tagName ?? "null",
		};
	}, SCROLLER_SELECTOR[scroller]);
}

for (const scroller of ["root", "ancestor"] as const) {
	scenario(
		`OV2: a remote caret scrolled out of an unpositioned ${scroller === "root" ? "overflow:auto editor root" : "scroller around the editor root"} is clipped, not painted over app chrome`,
		async (s, page) => {
			await s.load("hello-world");
			await arrange(page, scroller);
			await s.geometry.flushEightRemoteCarets([
				{ blockId: HELLO_ID, offset: REMOTE_OFFSET },
			]);
			expect(remoteCarets(await readSettledLayer(page))).toHaveLength(1);

			await scroll(page, scroller);
			await readSettledLayer(page);
			const probe = await probeClip(page, scroller);
			await attachJson("ov2-scroll-clip", { scroller, probe });

			expect(
				probe.itemBox.bottom <= probe.scrollerTop,
				`precondition: the caret is scrolled above the scroller (${JSON.stringify(probe)})`,
			).toBe(true);
			expectCheck(
				"OV2: the scrolled-out caret is clipped by the scroller; the app chrome under it is what shows",
				probe.hit === "chrome",
				probe,
			);
		},
	);
}
