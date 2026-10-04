import { expect, type Page } from "@playwright/test";
import { SEMANTICS_IDS } from "../fixtures/semantics";
import { scenario } from "../src/scenario";

/**
 * AX1 list semantics under editing (W6.R5–R7): groups are render-time
 * `div[data-pen-list-group][role="list"]` wrappers, and each item's block
 * host carries `role="listitem"` with its model level, position and set size.
 * Every step runs the standing S2 / OV4 checks, so a reparented block that
 * loses the caret fails here.
 */

type Item = { id: string; level: string; pos: string; size: string };

/** Each top-level group's items, in order; plain blocks are omitted. */
async function groups(page: Page): Promise<Item[][]> {
	return page.evaluate(() => {
		const host = document.querySelector("[data-pen-editor-blocks-host]")!;
		return [...host.children]
			.filter((child) => child.hasAttribute("data-pen-list-group"))
			.map((group) => {
				if (group.getAttribute("role") !== "list") throw new Error("group without role=list");
				return [...group.children].map((item) => {
					if (item.getAttribute("role") !== "listitem") throw new Error("item without role=listitem");
					return {
						id: item.getAttribute("data-block-id") ?? "",
						level: item.getAttribute("aria-level") ?? "",
						pos: item.getAttribute("aria-posinset") ?? "",
						size: item.getAttribute("aria-setsize") ?? "",
					};
				});
			});
	});
}

function positions(group: Item[]): string[] {
	return group.map((item) => `${item.level}:${item.pos}/${item.size}`);
}

async function caretAtEnd(page: Page, blockId: string): Promise<void> {
	await page.evaluate((id) => {
		const length = window.__penConformance.blockText(id).length;
		window.__penConformance.selectTextById(id, length, length);
	}, blockId);
}

async function caretBlockId(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const selection = window.__penConformance.selection;
		return selection?.type === "text" ? selection.focus.blockId : null;
	});
}

async function fieldFocused(page: Page): Promise<void> {
	await expect(page.locator("[data-pen-field-editor-active-surface]")).toBeFocused();
}

scenario(
	"AX1: Enter in a list item, Tab to indent, and Backspace to leave the list keep groups and positions correct",
	async (s, page) => {
		await s.load("semantics");
		expect((await groups(page)).map(positions)).toEqual([
			["1:1/2", "2:1/1", "1:2/2"],
			["1:1/1"],
			["1:1/2", "1:2/2"],
			["1:1/2", "1:2/2"],
		]);

		await caretAtEnd(page, "sem-b2");
		await s.keyboard.press("Enter");
		const added = await caretBlockId(page);
		expect(added).not.toBe("sem-b2");
		expect((await groups(page))[0]?.map((item) => item.id)).toEqual(["sem-b1", "sem-b1a", "sem-b2", added]);
		expect(positions((await groups(page))[0]!)).toEqual(["1:1/3", "2:1/1", "1:2/3", "1:3/3"]);
		await fieldFocused(page);

		await s.keyboard.press("Tab");
		expect(positions((await groups(page))[0]!)).toEqual(["1:1/2", "2:1/1", "1:2/2", "2:1/1"]);
		expect(await caretBlockId(page)).toBe(added);
		await fieldFocused(page);

		// Backspace in the empty item outdents, then leaves the list.
		for (let press = 0; press < 3; press += 1) {
			const left = await page.evaluate(
				(id) => document.querySelector(`[data-block-id="${id}"]`)?.getAttribute("role") !== "listitem",
				added,
			);
			if (left) break;
			await s.keyboard.press("Backspace");
		}
		const after = await groups(page);
		expect(after[0]?.map((item) => item.id)).toEqual(["sem-b1", "sem-b1a", "sem-b2"]);
		expect(positions(after[0]!)).toEqual(["1:1/2", "2:1/1", "1:2/2"]);
		expect(await caretBlockId(page)).toBe(added);
		await fieldFocused(page);
	},
);

scenario(
	"AX1: converting the paragraph between two lists to a list item merges the groups and keeps the caret",
	async (s, page) => {
		await s.load("semantics");
		expect(await groups(page)).toHaveLength(4);
		await caretAtEnd(page, SEMANTICS_IDS.between);
		await fieldFocused(page);

		await s.apply([
			{ type: "set-props", blockId: SEMANTICS_IDS.between, props: { type: "bulletListItem" } },
		]);
		const merged = await groups(page);
		expect(merged).toHaveLength(3);
		expect(merged[0]?.map((item) => item.id)).toEqual([
			"sem-b1",
			"sem-b1a",
			"sem-b2",
			SEMANTICS_IDS.between,
			"sem-b3",
		]);
		expect(positions(merged[0]!)).toEqual(["1:1/4", "2:1/1", "1:2/4", "1:3/4", "1:4/4"]);
		expect(await caretBlockId(page)).toBe(SEMANTICS_IDS.between);

		// The caret still types into the converted block.
		await s.keyboard.type("!");
		await expect
			.poll(() => page.evaluate((id) => window.__penConformance.blockText(id), SEMANTICS_IDS.between))
			.toBe("Between the lists!");
	},
);

scenario(
	"FE5: an expanded selection across a list group boundary maps both endpoints",
	async (s, page) => {
		await s.load("semantics");
		const between = page.locator(`[data-block-id="${SEMANTICS_IDS.between}"] [data-pen-inline-content]`);
		const target = page.locator('[data-block-id="sem-b3"] [data-pen-inline-content]');
		await between.click();
		await target.click({ modifiers: ["Shift"] });
		// The standing check after this step compares authority with the DOM (S2).
		await s.keyboard.press("Shift+ArrowLeft");
		const selection = await page.evaluate(() => window.__penConformance.selection);
		expect(selection?.type).toBe("text");
		if (selection?.type !== "text") return;
		expect(selection.anchor.blockId).toBe(SEMANTICS_IDS.between);
		expect(selection.focus.blockId).toBe("sem-b3");
	},
);
