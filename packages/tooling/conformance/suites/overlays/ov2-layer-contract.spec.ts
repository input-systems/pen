import { expect, test, type Page } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { localCarets, readSettledLayer } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import type { ScenarioApi } from "../../src/types";
import { clickOffset, logLoad } from "../../src/specHelpers";

const HELLO_ID = "hello-p1";

type CaretPaint = {
	kind: "present" | "absent" | "unchecked";
	reason: string;
	pointerEvents: string;
	transform: string;
	styleLeft: string;
	styleTop: string;
	stylePosition: string;
	lastChildOfRoot: boolean;
};

async function paintLayerCaret(
	s: ScenarioApi,
	blockId: string,
	offset: number,
): Promise<void> {
	const flushed = await s.geometry.flushEightRemoteCarets([
		{ blockId, offset },
	]);
	expect(
		flushed.paintedCount,
		formatCheckReport(
			"OV2: paint-plan layer painted a caret item",
			flushed.paintedCount === 1 ? "passed" : "failed",
			`paintedCount=${flushed.paintedCount} overlayConnected=${String(flushed.overlayConnected)}`,
		),
	).toBe(1);
}

async function readCaretPaint(page: Page): Promise<CaretPaint> {
	return page.evaluate(() => {
		const layer = document.querySelector("[data-pen-overlay-layer]");
		const root = document.querySelector("[data-pen-editor-root]");
		// OV2 (W35.R2): pen-dom appends one layer per root as its last child.
		const lastChildOfRoot =
			layer instanceof HTMLElement &&
			root != null &&
			root.lastElementChild === layer &&
			root.querySelectorAll("[data-pen-overlay-layer]").length === 1;
		if (!(layer instanceof HTMLElement)) {
			return {
				kind: "unchecked" as const,
				reason: "overlay layer is not mounted — flush the paint-plan layer first",
				pointerEvents: "",
				transform: "",
				styleLeft: "",
				styleTop: "",
				stylePosition: "",
				lastChildOfRoot: false,
			};
		}
		const caret = layer.querySelector('[data-pen-overlay-item="caret"]');
		if (!(caret instanceof HTMLElement)) {
			return {
				kind: "absent" as const,
				reason: "overlay layer is mounted, caret item is missing",
				pointerEvents: getComputedStyle(layer).pointerEvents,
				transform: "",
				styleLeft: "",
				styleTop: "",
				stylePosition: layer.style.position,
				lastChildOfRoot,
			};
		}
		return {
			kind: "present" as const,
			reason: "overlay layer caret item is painted",
			pointerEvents: getComputedStyle(caret).pointerEvents,
			transform: caret.style.transform,
			styleLeft: caret.style.left,
			styleTop: caret.style.top,
			stylePosition: caret.style.position,
			lastChildOfRoot,
		};
	});
}

scenario(
	"OV2: overlay caret has pointer-events none so a click reaches the text",
	async (s, page) => {
		const loads = logLoad("OV2-pointer");
		await s.load("hello-world");
		await paintLayerCaret(s, HELLO_ID, 2);
		const paint = await readCaretPaint(page);
		await test.info().attach("ov2-pointer", {
			body: JSON.stringify({ loadavg: loads, paint }, null, 2),
			contentType: "application/json",
		});

		expect(
			paint.kind,
			formatCheckReport(
				"OV2: overlay layer caret is on screen to inspect pointer-events",
				paint.kind === "present" ? "passed" : "failed",
				paint.reason,
			),
		).toBe("present");
		expect(
			paint.pointerEvents,
			formatCheckReport(
				"OV2: caret pointer-events is none",
				paint.pointerEvents === "none" ? "passed" : "failed",
				`pointerEvents=${paint.pointerEvents}`,
			),
		).toBe("none");

		const before = await page.evaluate(
			() => window.__penConformance.documentText,
		);
		await clickOffset(page, HELLO_ID, 2);
		await page.keyboard.type("x");
		const after = await page.evaluate(
			() => window.__penConformance.documentText,
		);
		expect(
			after.includes("x") && after !== before,
			formatCheckReport(
				"OV2: typing still reaches the document through the overlay",
				after.includes("x") ? "passed" : "failed",
				`before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
			),
		).toBe(true);
	},
);

scenario(
	"OV2: overlay caret is painted with transforms only (no layout left/top)",
	async (s, page) => {
		const loads = logLoad("OV2-transform");
		await s.load("hello-world");
		await paintLayerCaret(s, HELLO_ID, 2);
		const paint = await readCaretPaint(page);
		await test.info().attach("ov2-transform", {
			body: JSON.stringify({ loadavg: loads, paint }, null, 2),
			contentType: "application/json",
		});

		expect(
			paint.kind,
			formatCheckReport(
				"OV2: overlay caret is on screen to inspect paint",
				paint.kind === "present" ? "passed" : "failed",
				paint.reason,
			),
		).toBe("present");
		expect(
			/translate3d\(/.test(paint.transform),
			formatCheckReport(
				"OV2: caret uses a translate3d paint",
				/translate3d\(/.test(paint.transform) ? "passed" : "failed",
				`transform=${paint.transform}`,
			),
		).toBe(true);
		const layoutFree =
			(paint.styleLeft === "" || paint.styleLeft === "0px") &&
			(paint.styleTop === "" || paint.styleTop === "0px");
		expect(
			layoutFree,
			formatCheckReport(
				"OV2: caret does not set layout-inducing left/top",
				layoutFree ? "passed" : "failed",
				`left=${paint.styleLeft} top=${paint.styleTop} position=${paint.stylePosition}`,
			),
		).toBe(true);
		expect(
			paint.lastChildOfRoot,
			formatCheckReport(
				"OV2: the overlay layer is the editor root's only layer and its last child",
				paint.lastChildOfRoot ? "passed" : "failed",
			),
		).toBe(true);
	},
);

scenario(
	"OV2: the overlay layer is the editor root's last child",
	async (s, page) => {
		await s.load("hello-world");
		const layer = await readSettledLayer(page);
		expect(layer.mounted).toBe(true);
		expect(
			layer.lastChildOfRoot,
			formatCheckReport(
				"OV2: one layer, appended as the root's last child",
				layer.lastChildOfRoot ? "passed" : "failed",
			),
		).toBe(true);
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
		await expect
			.poll(async () => localCarets(await readSettledLayer(page)).length)
			.toBe(1);
		const caret = localCarets(await readSettledLayer(page))[0]!;
		// The point is the next character's left edge plus one pixel.
		const point = await getInlineOffsetPoint(page, { blockId: HELLO_ID, offset: 2 });
		const onText =
			Math.abs(caret.box.left - (point.x - 1)) <= 1 &&
			caret.box.top <= point.y &&
			caret.box.bottom >= point.y;
		expect(
			onText,
			formatCheckReport(
				"OV2: the caret is on the text, not offset by the ancestor's transform",
				onText ? "passed" : "failed",
				`caret=${JSON.stringify(caret.box)} point=${JSON.stringify(point)}`,
			),
		).toBe(true);
	},
	{ url: "/?modal=1&customCaret=1" },
);
