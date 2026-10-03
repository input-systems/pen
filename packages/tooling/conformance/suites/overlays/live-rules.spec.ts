import { expect, test, type Page } from "@playwright/test";
import { loadavg } from "node:os";
import { formatCheckReport } from "../../src/checkReport";
import { getInlineOffsetPoint } from "../../src/domGeometry";
import { scenario } from "../../src/scenario";

type OverlaySnapshot = {
	kind: "present" | "absent" | "unchecked";
	reason: string;
	overlayMounted: boolean;
	overlayVisible: boolean;
	caretCount: number;
	caretColor: string | null;
	blockId: string | null;
	offset: string | null;
	width: number;
	height: number;
	left: number;
	top: number;
};


function logLoad(label: string): number[] {
	const loads = loadavg();
	console.log(`${label} loadavg ${loads.join(" ")}`);
	return loads;
}

async function attachJson(name: string, payload: unknown): Promise<void> {
	await test.info().attach(name, {
		body: JSON.stringify({ loadavg: loadavg(), payload }, null, 2),
		contentType: "application/json",
	});
}

async function clickOffset(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId, offset });
	await page.mouse.click(point.x, point.y);
	await expect
		.poll(async () => {
			return page.evaluate(() => {
				const selection = window.__penConformance.selection;
				if (selection?.type !== "text") {
					return "not-text";
				}
				if (!window.__penConformance.isCollapsed()) {
					return "expanded";
				}
				return `${selection.focus.blockId}:${selection.focus.offset}`;
			});
		})
		.toBe(`${blockId}:${offset}`);
}

async function readOverlay(page: Page): Promise<OverlaySnapshot> {
	return page.evaluate(() => {
		const overlay = document.querySelector("[data-pen-overlay-layer]");
		if (!(overlay instanceof HTMLElement)) {
			return {
				kind: "unchecked" as const,
				reason: "the overlay layer is not mounted",
				overlayMounted: false,
				overlayVisible: false,
				caretCount: 0,
				caretColor: null,
				blockId: null,
				offset: null,
				width: 0,
				height: 0,
				left: 0,
				top: 0,
			};
		}
		const caret = document.querySelector("[data-pen-editor-caret]");
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
		);
		const visible = overlay.hasAttribute("data-caret-visible");
		if (!(caret instanceof HTMLElement)) {
			return {
				kind: "absent" as const,
				reason: visible
					? "overlay flagged visible but no caret node"
					: "overlay mounted, caret node absent",
				overlayMounted: true,
				overlayVisible: visible,
				caretCount: 0,
				caretColor:
					surface instanceof HTMLElement
						? surface.style.caretColor
						: null,
				blockId: null,
				offset: null,
				width: 0,
				height: 0,
				left: 0,
				top: 0,
			};
		}
		const box = caret.getBoundingClientRect();
		return {
			kind: "present" as const,
			reason: "overlay caret node is in the tree",
			overlayMounted: true,
			overlayVisible: visible,
			caretCount: 1,
			caretColor:
				surface instanceof HTMLElement
					? surface.style.caretColor
					: null,
			blockId: caret.getAttribute("data-block-id"),
			offset: caret.getAttribute("data-offset"),
			width: box.width,
			height: box.height,
			left: box.left,
			top: box.top,
		};
	});
}

scenario(
	"O1: collapsed caret adjacent to an inline atom keeps the overlay at that edge",
	async (s, page) => {
		const loads = logLoad("O1-atom");
		await s.load("hello-world");
		await s.apply([
			{
				type: "splice-text",
				blockId: "hello-p1",
				from: 5,
				to: 5,
				insert: {
					nodeType: "mention",
					props: { id: "user-ada", label: "Ada" },
				},
			},
		]);
		await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();
		await clickOffset(page, "hello-p1", 5);
		const overlay = await readOverlay(page);
		const atom = await page.evaluate(() => {
			const node = document.querySelector("[data-pen-inline-atom]");
			if (!(node instanceof HTMLElement)) {
				return null;
			}
			const box = node.getBoundingClientRect();
			return {
				left: box.left,
				right: box.right,
				top: box.top,
				width: box.width,
			};
		});
		await attachJson("o1-atom", { loads, overlay, atom });

		expect(
			overlay.kind === "unchecked" ? "unchecked" : "checked",
			formatCheckReport(
				"O1: overlay host was checkable next to the atom",
				overlay.kind === "unchecked" ? "skipped" : "passed",
				overlay.reason,
			),
		).toBe("checked");
		expect(
			atom,
			formatCheckReport(
				"O1: mention atom is measurable",
				atom ? "passed" : "skipped",
				atom ? undefined : "data-pen-inline-atom missing",
			),
		).not.toBeNull();
		expect(
			overlay.kind,
			formatCheckReport(
				"O1: overlay caret is drawn beside the atom",
				overlay.kind === "present" ? "passed" : "failed",
				overlay.reason,
			),
		).toBe("present");
		expect(
			overlay.offset,
			formatCheckReport(
				"O1: overlay offset is the atom edge",
				overlay.offset === "5" ? "passed" : "failed",
				`offset=${overlay.offset}`,
			),
		).toBe("5");
		const nearAtom =
			atom != null &&
			overlay.left + overlay.width >= atom.left - 4 &&
			overlay.left <= atom.right + 4;
		expect(
			nearAtom,
			formatCheckReport(
				"O1: overlay rect sits on the atom edge",
				nearAtom ? "passed" : "failed",
				`overlay.left=${overlay.left} atom=${JSON.stringify(atom)}`,
			),
		).toBe(true);
		expect(
			overlay.caretColor,
			formatCheckReport(
				"O1: the native caret is hidden beside the atom",
				overlay.caretColor === "transparent" ? "passed" : "failed",
				`caretColor=${overlay.caretColor}`,
			),
		).toBe("transparent");
	},
);

scenario(
	"O2: empty text block draws an overlay caret with non-zero height",
	async (s, page) => {
		const loads = logLoad("O2");
		await s.load("empty");
		const overlay = await readOverlay(page);
		await attachJson("o2-empty", { loads, overlay });

		expect(
			overlay.kind === "unchecked" ? "unchecked" : "checked",
			formatCheckReport(
				"O2: overlay host was checkable on the empty block",
				overlay.kind === "unchecked" ? "skipped" : "passed",
				overlay.reason,
			),
		).toBe("checked");
		expect(
			overlay.kind,
			formatCheckReport(
				"O2: empty block uses the overlay caret",
				overlay.kind === "present" ? "passed" : "failed",
				overlay.reason,
			),
		).toBe("present");
		expect(
			overlay.blockId,
			formatCheckReport(
				"O2: overlay is on empty-p1",
				overlay.blockId === "empty-p1" ? "passed" : "failed",
				`blockId=${overlay.blockId}`,
			),
		).toBe("empty-p1");
		expect(
			overlay.height,
			formatCheckReport(
				"O2: empty-block caret height is not collapsed",
				overlay.height > 0 ? "passed" : "failed",
				`box=${overlay.width}x${overlay.height}`,
			),
		).toBeGreaterThan(0);
		expect(
			overlay.caretColor,
			formatCheckReport(
				"O2: native caret-color is transparent on empty",
				overlay.caretColor === "transparent" ? "passed" : "failed",
				`caretColor=${overlay.caretColor}`,
			),
		).toBe("transparent");
	},
);
