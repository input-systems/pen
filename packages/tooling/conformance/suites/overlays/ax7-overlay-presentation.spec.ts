import { expect, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { expectCheck, insertMention, readSettledLayer } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachJson } from "../specHelpers";

type Presentation = {
	elements: number;
	kinds: string[];
	offenders: { tag: string; item: string | null; ariaHidden: string | null; pointerEvents: string }[];
};

/** Every element in the layer, the layer included: aria-hidden true, computed pointer-events none. */
async function walkLayer(page: Page): Promise<Presentation> {
	await readSettledLayer(page);
	return page.evaluate(() => {
		const layer = document.querySelector("[data-pen-overlay-layer]");
		if (!(layer instanceof HTMLElement)) {
			return { elements: 0, kinds: [], offenders: [{ tag: "none", item: null, ariaHidden: null, pointerEvents: "" }] };
		}
		const elements = [layer, ...layer.querySelectorAll<HTMLElement>("*")];
		const offenders = elements
			.filter((element) => {
				// aria-hidden on an ancestor covers descendants; items must carry it themselves.
				const isItem = element === layer || element.hasAttribute("data-pen-overlay-item");
				const hidden = element.getAttribute("aria-hidden") === "true";
				return (isItem && !hidden) || getComputedStyle(element).pointerEvents !== "none";
			})
			.map((element) => ({
				tag: element.tagName.toLowerCase(),
				item: element.getAttribute("data-pen-overlay-item"),
				ariaHidden: element.getAttribute("aria-hidden"),
				pointerEvents: getComputedStyle(element).pointerEvents,
			}));
		return {
			elements: elements.length,
			kinds: [...layer.querySelectorAll("[data-pen-overlay-item]")].map(
				(node) => node.getAttribute("data-pen-overlay-item") ?? "",
			),
			offenders,
		};
	});
}

function assertPresentation(label: string, result: Presentation, kind: string): void {
	expectCheck(`AX7: ${label} painted a ${kind}`, result.kinds.includes(kind), result.kinds);
	expectCheck(
		`AX7: ${label} every overlay element is aria-hidden and inert`,
		result.offenders.length === 0,
		result.offenders,
	);
}

scenario(
	"AX7: every element in the overlay layer is aria-hidden with computed pointer-events none",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.apply([
			insertMention("two-p1", 5),
			{ type: "insert-block", blockId: "ax7-empty", blockType: "paragraph", props: {}, position: { after: "two-p1" } },
			{ type: "insert-block", blockId: "ax7-divider", blockType: "divider", props: {}, position: { after: "two-p2" } },
		]);
		await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();

		const beside = await getInlineOffsetPoint(page, { blockId: "two-p1", offset: 5 });
		await page.mouse.click(beside.x, beside.y);
		const o1 = await walkLayer(page);

		await page.locator('[data-pen-editor-block][data-block-id="ax7-divider"]').click();
		const o3 = await walkLayer(page);

		await s.mouse.dragText({
			from: { blockId: "two-p2", offset: 2 },
			to: { blockId: "ax7-empty", offset: 0 },
		});
		const o4 = await walkLayer(page);
		await attachJson("ax7-layer", { o1, o3, o4 });

		assertPresentation("O1", o1, "caret");
		assertPresentation("O3", o3, "block-outline");
		assertPresentation("O4", o4, "caret");
	},
);
