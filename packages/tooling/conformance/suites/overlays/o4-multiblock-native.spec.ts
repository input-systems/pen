import { expect, type Page } from "@playwright/test";
import {
	expectCheck,
	itemsOfKind,
	localCarets,
	readCaretOverlay,
	readSettledLayer,
} from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachJson, attachLoadavg, readSelection } from "../specHelpers";

type NativeSnapshot = {
	collapsed: boolean | null;
	rangeCount: number;
};

async function readNative(page: Page): Promise<NativeSnapshot> {
	return page.evaluate(() => {
		const native = window.getSelection();
		if (!native) {
			return { collapsed: null, rangeCount: 0 };
		}
		return { collapsed: native.isCollapsed, rangeCount: native.rangeCount };
	});
}

scenario(
	"O4: a multi-block text drag keeps the native selection visible",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.mouse.dragText({
			from: { blockId: "two-p1", offset: 2 },
			to: { blockId: "two-p2", offset: 5 },
		});

		const selection = await readSelection(page);
		const native = await readNative(page);
		const overlay = await readCaretOverlay(page);
		const multiBlock =
			selection?.type === "text" &&
			selection.anchor.blockId !== selection.focus.blockId;
		await attachLoadavg("o4-multiblock", { selection, native, overlay, multiBlock });

		expectCheck(
			"O4: drag stayed a multi-block text selection",
			multiBlock,
			`selection=${JSON.stringify(selection)}`,
		);
		expectCheck(
			"O4: native selection stays visible across blocks",
			native.collapsed === false && native.rangeCount > 0,
			`native=${JSON.stringify(native)}`,
		);
		expectCheck("O4: overlay host was checkable", overlay.layerMounted);
		expectCheck(
			"O4: no overlay caret unless an endpoint is O1/O2",
			!(overlay.caret && overlay.caretVisible),
			overlay,
		);
	},
);

scenario(
	"O4: an endpoint in an empty block gets an endpoint caret while the native range stays",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.apply([
			{
				type: "insert-block",
				blockId: "o4-empty",
				blockType: "paragraph",
				props: {},
				position: { after: "two-p1" },
			},
		]);
		await s.mouse.dragText({
			from: { blockId: "two-p1", offset: 2 },
			to: { blockId: "o4-empty", offset: 0 },
		});
		const selection = await readSelection(page);
		const native = await readNative(page);
		const layer = await readSettledLayer(page);
		const endpoints = itemsOfKind(layer, "caret").filter(
			(item) => item.endpoint !== null,
		);
		await attachJson("o4-endpoint", { selection, native, layer });

		expect(selection).toMatchObject({
			type: "text",
			anchor: { blockId: "two-p1", offset: 2 },
			focus: { blockId: "o4-empty", offset: 0 },
		});
		expectCheck(
			"O4: the native range stays visible",
			native.collapsed === false && native.rangeCount > 0,
			`native=${JSON.stringify(native)}`,
		);
		expect(endpoints.map((item) => [item.endpoint, item.blockId])).toEqual([
			["focus", "o4-empty"],
		]);
		expect(endpoints[0]!.box.height).toBeGreaterThan(0);
		expect(localCarets(layer), "O4: no local caret over a range").toEqual([]);
		expect(
			layer.caretColor,
			"O4: endpoint carets never hide the native caret",
		).not.toBe("transparent");
	},
);
