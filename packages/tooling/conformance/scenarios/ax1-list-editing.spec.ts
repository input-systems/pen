import { expect, type Page } from "@playwright/test";
import { SEMANTICS_IDS } from "../fixtures/semantics";
import { scenario } from "../src/scenario";
import type { ScenarioApi } from "../src/types";

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

/** Each top-level group's block ids, in order. */
async function groupIds(page: Page): Promise<string[][]> {
	return (await groups(page)).map((group) => group.map((item) => item.id));
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

/**
 * The caret and focus stay in `blockId`: "!" typed at the caret makes it
 * read `expected`.
 */
async function keepsCaret(s: ScenarioApi, page: Page, blockId: string, expected: string): Promise<void> {
	expect(await caretBlockId(page)).toBe(blockId);
	await fieldFocused(page);
	await s.keyboard.type("!");
	await expect
		.poll(() => page.evaluate((id) => window.__penConformance.blockText(id), blockId))
		.toBe(expected);
}

/**
 * AX1 groups are render-time wrappers in every binding, so a regroup moves a
 * block element between wrappers. React and Vue remount it; the vanilla tree
 * moves it. Either way focus and the caret stay in the block (P4).
 */
const MERGED_IDS = ["sem-b1", "sem-b1a", "sem-b2", SEMANTICS_IDS.between, "sem-b3"];

const SURFACES = [
	{ suffix: "", url: undefined },
	{ suffix: " (vue)", url: "/?surface=vue" },
	{ suffix: " (vanilla)", url: "/?surface=vanilla" },
] as const;

for (const { suffix, url } of SURFACES) {
	scenario(
		`AX1: Enter in a list item, Tab to indent, and Backspace to leave the list keep groups and positions correct${suffix}`,
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
			expect((await groupIds(page))[0]).toEqual(["sem-b1", "sem-b1a", "sem-b2", added]);
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
			const after = (await groups(page))[0]!;
			expect(after.map((item) => item.id)).toEqual(["sem-b1", "sem-b1a", "sem-b2"]);
			expect(positions(after)).toEqual(["1:1/2", "2:1/1", "1:2/2"]);
			expect(await caretBlockId(page)).toBe(added);
			await fieldFocused(page);
		},
		{ url },
	);

	scenario(
		`AX1: converting the paragraph between two lists to a list item merges the groups and keeps the caret${suffix}`,
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
			expect(merged[0]?.map((item) => item.id)).toEqual(MERGED_IDS);
			expect(positions(merged[0]!)).toEqual(["1:1/4", "2:1/1", "1:2/4", "1:3/4", "1:4/4"]);
			// The caret still types into the converted block.
			await keepsCaret(s, page, SEMANTICS_IDS.between, "Between the lists!");
		},
		{ url },
	);

	scenario(
		`AX1: a remote merge of two lists keeps focus and the caret in an item of the later list${suffix}`,
		async (s, page) => {
			await s.load("semantics");
			await caretAtEnd(page, "sem-b3");
			await fieldFocused(page);

			await s.remote.apply([
				{ type: "set-props", blockId: SEMANTICS_IDS.between, props: { type: "bulletListItem" } },
			]);
			expect((await groupIds(page))[0]).toEqual(MERGED_IDS);
			await keepsCaret(s, page, "sem-b3", "Second list bullet!");
		},
		{ url },
	);

	scenario(
		`AX1: converting the first item of a run to a paragraph keeps focus and the caret in it and in a later item${suffix}`,
		async (s, page) => {
			await s.load("semantics");
			await caretAtEnd(page, "sem-b1");
			await fieldFocused(page);

			await s.apply([{ type: "set-props", blockId: "sem-b1", props: { type: "paragraph" } }]);
			expect((await groupIds(page))[0]).toEqual(["sem-b1a", "sem-b2"]);
			await keepsCaret(s, page, "sem-b1", "First bullet!");

			// The run is re-keyed again; the caret in its last item stays.
			await caretAtEnd(page, "sem-b2");
			await fieldFocused(page);
			await s.remote.apply([{ type: "set-props", blockId: "sem-b1a", props: { type: "paragraph" } }]);
			expect((await groupIds(page))[0]).toEqual(["sem-b2"]);
			await keepsCaret(s, page, "sem-b2", "Second bullet!");
		},
		{ url },
	);

	scenario(
		`AX1: splitting the run above the caret keeps focus and the caret in the lower item${suffix}`,
		async (s, page) => {
			await s.load("semantics");
			await caretAtEnd(page, "sem-b2");
			await fieldFocused(page);

			await s.remote.apply([{ type: "set-props", blockId: "sem-b1a", props: { type: "paragraph", indent: 0 } }]);
			const split = await groupIds(page);
			expect(split[0]).toEqual(["sem-b1"]);
			expect(split[1]).toEqual(["sem-b2"]);
			await keepsCaret(s, page, "sem-b2", "Second bullet!");
		},
		{ url },
	);
}

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
