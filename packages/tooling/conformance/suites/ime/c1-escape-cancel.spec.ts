import { expect, test } from "@playwright/test";
import { loadavg } from "node:os";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import {
	disableEditContext,
	dispatchComposingKey,
	readSurfaceText,
	replayCompositionStart,
} from "./compose";
import {
	installKeyProbe,
	readBackend,
	readDocumentText,
	readFocusOffset,
	readKeyProbe,
} from "../input/keys";

scenario(
	"C1: Escape during composition never preventDefaults",
	async (s, page) => {
		const loads = loadavg();
		console.log(`C1-escape loadavg ${loads.join(" ")}`);

		await s.load("hello-world");
		await page.keyboard.press("End");
		await replayCompositionStart(page);
		const prevented = await dispatchComposingKey(page, "Escape");
		const text = await readDocumentText(page);

		await test.info().attach("c1-escape", {
			body: JSON.stringify({ loadavg: loads, prevented, text }, null, 2),
			contentType: "application/json",
		});

		expect(
			prevented,
			formatCheckReport(
				"C1: Escape defaultPrevented during composition",
				prevented ? "failed" : "passed",
				`defaultPrevented=${prevented}`,
			),
		).toBe(false);
		expect(
			text.includes("Hello world") && !text.includes("ni"),
			formatCheckReport(
				"C1: Escape did not commit composed text",
				text.includes("Hello world") ? "passed" : "failed",
				`text=${JSON.stringify(text)}`,
			),
		).toBe(true);
	},
	{
		initScript: () => {
			delete (globalThis as { EditContext?: unknown }).EditContext;
			delete (window as { EditContext?: unknown }).EditContext;
		},
	},
);

scenario(
	"C1: Chromium CDP composition is cancelled by Escape without preventDefault",
	async (s, page) => {
		const loads = loadavg();
		console.log(`C1-cdp loadavg ${loads.join(" ")}`);
		test.skip(
			test.info().project.name !== "chromium",
			"Input.imeSetComposition is Chromium CDP",
		);

		await s.load("hello-world");
		await page.keyboard.press("End");
		await installKeyProbe(page);

		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "nihao",
			selectionStart: 5,
			selectionEnd: 5,
		});
		const composingDom = await readSurfaceText(page);
		expect(
			composingDom.includes("nihao"),
			formatCheckReport(
				"C1: CDP composition is visible in the field",
				composingDom.includes("nihao") ? "passed" : "failed",
				`dom=${JSON.stringify(composingDom)}`,
			),
		).toBe(true);

		await page.keyboard.press("Escape");
		const escape = (await readKeyProbe(page)).find(
			(entry) => entry.key === "Escape",
		);
		const text = await readDocumentText(page);
		const afterDom = await readSurfaceText(page);

		await test.info().attach("c1-cdp", {
			body: JSON.stringify(
				{
					loadavg: loads,
					composingDom,
					afterDom,
					escape,
					text,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		if (escape) {
			expect(
				escape.defaultPrevented,
				formatCheckReport(
					"C1: live Escape was not preventDefaulted",
					escape.defaultPrevented ? "failed" : "passed",
					`escape=${JSON.stringify(escape)}`,
				),
			).toBe(false);
		}
		expect(
			text.includes("nihao"),
			formatCheckReport(
				"C1: Escape did not commit the CDP composition",
				text.includes("nihao") ? "failed" : "passed",
				`text=${JSON.stringify(text)} afterDom=${JSON.stringify(afterDom)}`,
			),
		).toBe(false);
	},
);

/**
 * C1: a cancelled composition leaves the caret where the composition
 * started. Every update moves the browser's caret inside the composed run;
 * once the IME empties the run, the authority caret is the composition start
 * again, so the next keystroke lands there.
 */
const CANCEL_CASES = [
	{ label: "three updates", updates: ["k", "ka", "kan"] },
	{ label: "one update", updates: ["kan"] },
];

for (const { label, updates } of CANCEL_CASES) {
	scenario(
		`C1: a cancelled composition restores the caret to its start (contenteditable, ${label})`,
		async (s, page) => {
			test.skip(
				test.info().project.name !== "chromium",
				"Input.imeSetComposition is Chromium CDP",
			);
			await s.load("hello-world");
			expect((await readBackend(page)).hasEditContext).toBe(false);
			await page.evaluate(() =>
				window.__penConformance.selectTextById("hello-p1", 5, 5),
			);
			const cdp = await page.context().newCDPSession(page);
			// The trailing empty update is the IME cancelling the composition.
			for (const update of [...updates, ""]) {
				await cdp.send("Input.imeSetComposition", {
					text: update,
					selectionStart: update.length,
					selectionEnd: update.length,
				});
			}
			expect(await readFocusOffset(page), "the caret is back at the composition start").toBe(5);
			await page.keyboard.type("Q");
			expect(await readDocumentText(page)).toBe("HelloQ world");
			expect(await readFocusOffset(page), "the caret follows the typed Q").toBe(6);
			await s.assert.domMatchesAuthority();
		},
		{ initScript: disableEditContext },
	);
}
