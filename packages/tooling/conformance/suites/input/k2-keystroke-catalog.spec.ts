import { expect, test } from "@playwright/test";
import { loadavg } from "node:os";
import {
	NESTED_TOGGLE_CHILD_ID,
	NESTED_TOGGLE_CHILD_TEXT,
} from "../../fixtures/catalog";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { readDocumentText, readFocusOffset } from "./keys";
import { clickOffset } from "../specHelpers";

scenario(
	"K2: ArrowRight then Backspace via keystroke delete the first grapheme",
	async (s, page) => {
		const loads = loadavg();
		console.log(`K2-backspace loadavg ${loads.join(" ")}`);

		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 0);
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 0 },
			focus: { blockId: "hello-p1", offset: 0 },
		});

		await page.keyboard.press("ArrowRight");
		const afterArrow = await readFocusOffset(page);
		expect(
			afterArrow,
			formatCheckReport(
				"K2: ArrowRight advanced one grapheme",
				afterArrow === 1 ? "passed" : "failed",
				`offset ${afterArrow}`,
			),
		).toBe(1);

		await page.keyboard.press("Backspace");
		const text = await readDocumentText(page);
		const afterDelete = await readFocusOffset(page);

		await test.info().attach("k2-backspace", {
			body: JSON.stringify(
				{ loadavg: loads, afterArrow, afterDelete, text },
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			text.includes("ello world") && !text.includes("Hello"),
			formatCheckReport(
				"K2: Backspace removed H",
				text.includes("ello world") && !text.includes("Hello")
					? "passed"
					: "failed",
				`text=${JSON.stringify(text)}`,
			),
		).toBe(true);
		expect(afterDelete).toBe(0);
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"K2: Enter via keystroke splits the block and the next keystroke lands in the new one",
	async (s, page) => {
		const loads = loadavg();
		console.log(`K2-enter loadavg ${loads.join(" ")}`);

		await s.load("hello-world");
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("x");

		const snap = await page.evaluate(() =>
			window.__penConformance.documentSnapshot(),
		);
		await test.info().attach("k2-enter", {
			body: JSON.stringify({ loadavg: loads, snap }, null, 2),
			contentType: "application/json",
		});

		expect(
			snap.blocks.length,
			formatCheckReport(
				"K2: Enter created a second block",
				snap.blocks.length === 2 ? "passed" : "failed",
				`blocks=${snap.blocks.map((block) => block.text).join(" | ")}`,
			),
		).toBe(2);
		expect(snap.blocks[0]?.text).toBe("Hello world");
		expect(snap.blocks[1]?.text).toBe("x");
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"K2: Shift-ArrowRight then Mod-b via keystroke marks the first character bold",
	async (s, page) => {
		const loads = loadavg();
		console.log(`K2-bold loadavg ${loads.join(" ")}`);

		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 0);
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 0 },
			focus: { blockId: "hello-p1", offset: 0 },
		});
		await page.keyboard.press("Shift+ArrowRight");
		const modifier = process.platform === "darwin" ? "Meta" : "Control";
		await page.keyboard.press(`${modifier}+b`);

		const snap = await page.evaluate(() =>
			window.__penConformance.documentSnapshot(),
		);
		const bold = snap.blocks[0]?.deltas.some(
			(delta) =>
				typeof delta.insert === "string" &&
				delta.insert.includes("H") &&
				delta.attributes?.bold === true,
		);

		await test.info().attach("k2-bold", {
			body: JSON.stringify({ loadavg: loads, deltas: snap.blocks[0]?.deltas }, null, 2),
			contentType: "application/json",
		});

		expect(
			bold === true,
			formatCheckReport(
				"K2: Mod-b toggled bold on the selected grapheme",
				bold === true ? "passed" : "failed",
				`deltas=${JSON.stringify(snap.blocks[0]?.deltas)}`,
			),
		).toBe(true);
		await s.assert.domMatchesAuthority();
	},
);

scenario(
	"K2: a keystroke in a nested toggle child writes the child, not the parent",
	async (s, page) => {
		const loads = loadavg();
		console.log(`K2-nested loadavg ${loads.join(" ")}`);

		await s.load("nested-toggle");
		const dump = await page.evaluate(() => ({
			blockIds: [...document.querySelectorAll("[data-block-id]")].map(
				(element) => element.getAttribute("data-block-id"),
			),
			expanded: document
				.querySelector("[data-pen-toggle-trigger]")
				?.getAttribute("aria-expanded"),
			hasBody: document.querySelector("[data-pen-toggle-body]") != null,
		}));
		if (dump.expanded !== "true") {
			await page.locator("[data-pen-toggle-trigger]").click();
		}
		const child = page.locator(
			`[data-pen-toggle-body] [data-block-id="${NESTED_TOGGLE_CHILD_ID}"] [data-pen-inline-content]`,
		);
		expect(
			await child.count(),
			formatCheckReport(
				"K2: nested child surface is mounted",
				(await child.count()) > 0 ? "passed" : "failed",
				JSON.stringify(dump),
			),
		).toBeGreaterThan(0);
		await child.click();
		await page.keyboard.press("End");
		await page.keyboard.type("!");

		const texts = await page.evaluate((childId) => {
			const child = document.querySelector(
				`[data-block-id="${childId}"] [data-pen-inline-content]`,
			);
			const parent = document.querySelector(
				`[data-block-id="nest-parent"] [data-pen-inline-content]`,
			);
			return {
				documentText: window.__penConformance.documentText,
				childDom: child?.textContent ?? "",
				parentDom: parent?.textContent ?? "",
			};
		}, NESTED_TOGGLE_CHILD_ID);

		await test.info().attach("k2-nested", {
			body: JSON.stringify({ loadavg: loads, texts }, null, 2),
			contentType: "application/json",
		});

		expect(
			texts.documentText.includes(`${NESTED_TOGGLE_CHILD_TEXT}!`),
			formatCheckReport(
				"K2: nested child received the keystroke",
				texts.documentText.includes(`${NESTED_TOGGLE_CHILD_TEXT}!`)
					? "passed"
					: "failed",
				`documentText=${JSON.stringify(texts.documentText)}`,
			),
		).toBe(true);
		expect(
			texts.childDom.includes(`${NESTED_TOGGLE_CHILD_TEXT}!`),
			formatCheckReport(
				"K2: nested child DOM shows the keystroke",
				texts.childDom.includes(`${NESTED_TOGGLE_CHILD_TEXT}!`)
					? "passed"
					: "failed",
				`childDom=${JSON.stringify(texts.childDom)}`,
			),
		).toBe(true);
		expect(
			texts.documentText.includes("Toggle parent!"),
			formatCheckReport(
				"K2: parent did not absorb the nested keystroke",
				texts.documentText.includes("Toggle parent!")
					? "failed"
					: "passed",
				`parentDom=${JSON.stringify(texts.parentDom)}`,
			),
		).toBe(false);
		await s.assert.domMatchesAuthority();
	},
);
