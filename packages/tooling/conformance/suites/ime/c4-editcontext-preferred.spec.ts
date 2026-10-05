import { expect, test } from "@playwright/test";
import { loadavg } from "node:os";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { readBackend, readDocumentText } from "../input/keys";

scenario(
	"C4: Chromium prefers EditContext and composition commit writes the authority",
	async (s, page) => {
		const loads = loadavg();
		console.log(`C4 loadavg ${loads.join(" ")}`);
		test.skip(
			test.info().project.name !== "chromium",
			"C4 EditContext-preferred is Chromium",
		);

		expect(
			await page.evaluate(
				() => typeof (globalThis as { EditContext?: unknown }).EditContext,
			),
		).not.toBe("undefined");

		await s.load("hello-world");
		await page.keyboard.press("End");
		const backend = await readBackend(page);
		expect(
			backend.hasEditContext,
			formatCheckReport(
				"C4: preferred backend is EditContext",
				backend.hasEditContext ? "passed" : "failed",
				JSON.stringify(backend),
			),
		).toBe(true);

		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "你",
			selectionStart: 1,
			selectionEnd: 1,
		});
		await cdp.send("Input.insertText", { text: "你" });

		const text = await readDocumentText(page);
		const commits = await page.evaluate(() =>
			window.__penConformance.lastEvents.filter(
				(event) => event.type === "commit",
			),
		);

		await test.info().attach("c4-commit", {
			body: JSON.stringify({ loadavg: loads, backend, text, commits }, null, 2),
			contentType: "application/json",
		});

		expect(
			text.includes("你"),
			formatCheckReport(
				"C4: composition commit reached the authority",
				text.includes("你") ? "passed" : "failed",
				`text=${JSON.stringify(text)}`,
			),
		).toBe(true);
		expect(
			commits.length,
			formatCheckReport(
				"C4: composition used the normal apply path",
				commits.length > 0 ? "passed" : "failed",
				`commits=${commits.length}`,
			),
		).toBeGreaterThan(0);
		await s.assert.domMatchesAuthority();
	},
);
