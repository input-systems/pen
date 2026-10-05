import { expect, test } from "@playwright/test";
import { loadavg } from "node:os";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { readDocumentText } from "../input/keys";
import {
	replayCompositionCommitSameTurn,
	replayCompositionStart,
} from "./compose";

const COMPOSED = "あい";

scenario(
	"C3: multi-character compositionend reconciles in the same turn",
	async (s, page) => {
		const loads = loadavg();
		console.log(`C3-same-turn loadavg ${loads.join(" ")}`);

		await s.load("hello-world");
		await page.keyboard.press("End");
		await replayCompositionStart(page);
		const sameTurn = await replayCompositionCommitSameTurn(page, COMPOSED);

		await test.info().attach("c3-same-turn", {
			body: JSON.stringify({ loadavg: loads, sameTurn }, null, 2),
			contentType: "application/json",
		});

		expect(
			sameTurn.includes(COMPOSED),
			formatCheckReport(
				"C3: authority has composed text before the next frame",
				sameTurn.includes(COMPOSED) ? "passed" : "failed",
				`sameTurn=${JSON.stringify(sameTurn)}`,
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
	"C3: a second compositionstart in the same turn does not drop the first commit",
	async (s, page) => {
		const loads = loadavg();
		console.log(`C3-fast-cycle loadavg ${loads.join(" ")}`);

		await s.load("hello-world");
		await page.keyboard.press("End");

		const sameTurn = await page.evaluate((composed) => {
			const surface = document.querySelector(
				"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
			);
			if (!(surface instanceof HTMLElement)) {
				throw new Error("no active surface");
			}
			const inline = document.querySelector("[data-pen-inline-content]");
			if (!(inline instanceof HTMLElement)) {
				throw new Error("no inline");
			}
			surface.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			);
			inline.append(composed);
			surface.dispatchEvent(
				new CompositionEvent("compositionend", {
					bubbles: true,
					data: composed,
				}),
			);
			surface.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			);
			return window.__penConformance.documentText;
		}, COMPOSED);

		await page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				}),
		);
		const afterFrame = await readDocumentText(page);

		await test.info().attach("c3-fast-cycle", {
			body: JSON.stringify({ loadavg: loads, sameTurn, afterFrame }, null, 2),
			contentType: "application/json",
		});

		expect(
			afterFrame.includes(COMPOSED),
			formatCheckReport(
				"C3: first commit survived the GBoard fast cycle",
				afterFrame.includes(COMPOSED) ? "passed" : "failed",
				`sameTurn=${JSON.stringify(sameTurn)} afterFrame=${JSON.stringify(afterFrame)}`,
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
