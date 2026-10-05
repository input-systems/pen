import { expect, type Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import {
	expectCheck,
	expectLocalCarets,
	itemsOfKind,
	localCarets,
	near,
	readLayer,
	readSettledLayer,
	type LayerItem,
} from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";
import { attachLoadavg, clickOffset } from "../specHelpers";

const HELLO_ID = "hello-p1";

/** Paint one remote caret through the paint-plan layer and return it with the layer. */
async function paintLayerCaret(
	s: ScenarioApi,
	page: Page,
	label: string,
): Promise<{ caret: LayerItem | undefined; lastChildOfRoot: boolean }> {
	await s.load("hello-world");
	const flushed = await s.geometry.flushEightRemoteCarets([
		{ blockId: HELLO_ID, offset: 2 },
	]);
	expectCheck(
		"OV2: paint-plan layer painted a caret item",
		flushed.paintedCount === 1,
		`paintedCount=${flushed.paintedCount} overlayConnected=${String(flushed.overlayConnected)}`,
	);
	const layer = await readLayer(page);
	const caret = itemsOfKind(layer, "caret")[0];
	await attachLoadavg(label, { layer });
	// OV2 (W35.R2): pen-dom appends one layer per root as its last child.
	const layers = await page.locator("[data-pen-editor-root] [data-pen-overlay-layer]").count();
	expectCheck("OV2: the overlay caret is on screen to inspect", caret !== undefined, layer);
	return { caret, lastChildOfRoot: layer.lastChildOfRoot && layers === 1 };
}

scenario(
	"OV2: overlay caret has pointer-events none so a click reaches the text",
	async (s, page) => {
		const { caret } = await paintLayerCaret(s, page, "ov2-pointer");
		expectCheck(
			"OV2: caret pointer-events is none",
			caret?.pointerEvents === "none",
			`pointerEvents=${caret?.pointerEvents}`,
		);

		const before = await page.evaluate(
			() => window.__penConformance.documentText,
		);
		await clickOffset(page, HELLO_ID, 2);
		await page.keyboard.type("x");
		const after = await page.evaluate(
			() => window.__penConformance.documentText,
		);
		expectCheck(
			"OV2: typing still reaches the document through the overlay",
			after.includes("x") && after !== before,
			`before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
		);
	},
);

scenario(
	"OV2: overlay caret is painted with transforms only (no layout left/top)",
	async (s, page) => {
		const { caret, lastChildOfRoot } = await paintLayerCaret(s, page, "ov2-transform");
		expectCheck(
			"OV2: caret uses a translate3d paint",
			/translate3d\(/.test(caret?.transform ?? ""),
			`transform=${caret?.transform}`,
		);
		expectCheck(
			"OV2: caret does not set layout-inducing left/top",
			(caret?.styleLeft === "" || caret?.styleLeft === "0px") &&
				(caret?.styleTop === "" || caret?.styleTop === "0px"),
			`left=${caret?.styleLeft} top=${caret?.styleTop}`,
		);
		expectCheck(
			"OV2: the overlay layer is the editor root's only layer and its last child",
			lastChildOfRoot,
		);
	},
);

scenario(
	"OV2: the overlay layer is the editor root's last child",
	async (s, page) => {
		await s.load("hello-world");
		const layer = await readSettledLayer(page);
		expect(layer.mounted).toBe(true);
		expectCheck("OV2: one layer, appended as the root's last child", layer.lastChildOfRoot);
		expect(await page.locator("[data-pen-overlay-layer]").count()).toBe(1);
		expect(layer.ariaHidden).toBe("true");
		expect(layer.pointerEvents).toBe("none");
	},
);

scenario(
	"OV2: a caret inside a transformed and filtered ancestor sits on the text",
	async (s, page) => {
		await s.load("hello-world");
		await expect(page.locator("[data-pen-conformance-modal]")).toBeAttached();
		await clickOffset(page, HELLO_ID, 2);
		const caret = localCarets(await expectLocalCarets(page, 1))[0]!;
		// The point is the next character's left edge plus one pixel.
		const point = await getInlineOffsetPoint(page, { blockId: HELLO_ID, offset: 2 });
		expectCheck(
			"OV2: the caret is on the text, not offset by the ancestor's transform",
			near(caret.box.left, point.x - 1) &&
				caret.box.top <= point.y &&
				caret.box.bottom >= point.y,
			`caret=${JSON.stringify(caret.box)} point=${JSON.stringify(point)}`,
		);
	},
	{ url: "/?modal=1&customCaret=1" },
);
