import { expect, test } from "@playwright/test";
import { loadavg } from "node:os";
import { formatCheckReport } from "../../src/checkReport";
import { originHolds, recordPresence } from "../../src/selectionRecordCheck";
import { scenario } from "../../src/scenario";
import { readBackend, readDocumentText } from "../input/keys";
import { readSurfaceText, replayCompositionStart } from "./compose";

scenario(
	"C2: contenteditable remote commit mid-composition does not rewrite the field DOM",
	async (s, page) => {
		const loads = loadavg();
		console.log(`C2-ce loadavg ${loads.join(" ")}`);

		expect(
			await page.evaluate(
				() => typeof (globalThis as { EditContext?: unknown }).EditContext,
			),
		).toBe("undefined");

		await s.load("hello-world");
		await page.keyboard.press("End");
		await replayCompositionStart(page);

		const beforeDom = await readSurfaceText(page);
		const beforeAuthority = await readDocumentText(page);
		const beforeRecord = await page.evaluate(
			() => window.__penConformance.selectionRecord,
		);

		await page.evaluate(() => {
			window.__penConformance.remoteApply([
				{
					type: "splice-text",
					blockId: "hello-p1",
					from: 0,
				to: 0,
				insert: "X",
				},
			]);
		});

		const afterDom = await readSurfaceText(page);
		const afterAuthority = await readDocumentText(page);
		const afterRecord = await page.evaluate(
			() => window.__penConformance.selectionRecord,
		);
		const mapped = originHolds(afterRecord, "mapped");

		await test.info().attach("c2-ce", {
			body: JSON.stringify(
				{
					loadavg: loads,
					backend: await readBackend(page),
					beforeDom,
					afterDom,
					beforeAuthority,
					afterAuthority,
					beforeVersion: beforeRecord?.version ?? null,
					afterOrigin: afterRecord?.origin ?? null,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			afterDom,
			formatCheckReport(
				"C2: field DOM untouched during remote commit",
				afterDom === beforeDom ? "passed" : "failed",
				`dom ${JSON.stringify(beforeDom)} → ${JSON.stringify(afterDom)}`,
			),
		).toBe(beforeDom);
		expect(
			afterAuthority.includes("XHello"),
			formatCheckReport(
				"C2: authority accepted the remote insert",
				afterAuthority.includes("XHello") ? "passed" : "failed",
				`authority=${JSON.stringify(afterAuthority)}`,
			),
		).toBe(true);
		expect(
			recordPresence(afterRecord),
			formatCheckReport(
				"C2: selectionRecord after remote",
				afterRecord ? "passed" : "skipped",
				afterRecord ? undefined : "selectionRecord is not available",
			),
		).toBe("present");
		expect(
			mapped.skipped === true ? "unchecked" : "checked",
			formatCheckReport(
				"C2: mapped origin readable",
				mapped.skipped ? "skipped" : "passed",
				mapped.reason,
			),
		).toBe("checked");
		expect(
			mapped.ok,
			formatCheckReport(
				"C2: remapped caret origin is mapped",
				mapped.ok ? "passed" : "failed",
				mapped.reason,
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
	"C2: EditContext remote commit mid-composition does not rewrite the field DOM",
	async (s, page) => {
		const loads = loadavg();
		console.log(`C2-ec loadavg ${loads.join(" ")}`);
		test.skip(
			test.info().project.name !== "chromium",
			"C2 EditContext path is Chromium",
		);

		await s.load("hello-world");
		await page.keyboard.press("End");

		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "ni",
			selectionStart: 2,
			selectionEnd: 2,
		});

		const beforeDom = await readSurfaceText(page);
		await page.evaluate(() => {
			window.__penConformance.remoteApply([
				{
					type: "splice-text",
					blockId: "hello-p1",
					from: 0,
				to: 0,
				insert: "X",
				},
			]);
		});
		const afterDom = await readSurfaceText(page);
		const afterAuthority = await readDocumentText(page);

		await test.info().attach("c2-ec", {
			body: JSON.stringify(
				{
					loadavg: loads,
					backend: await readBackend(page),
					beforeDom,
					afterDom,
					afterAuthority,
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(
			afterDom,
			formatCheckReport(
				"C2: EditContext field DOM untouched during remote commit",
				afterDom === beforeDom ? "passed" : "failed",
				`dom ${JSON.stringify(beforeDom)} → ${JSON.stringify(afterDom)}`,
			),
		).toBe(beforeDom);
		expect(
			afterAuthority.includes("XHello"),
			formatCheckReport(
				"C2: EditContext authority accepted the remote insert",
				afterAuthority.includes("XHello") ? "passed" : "failed",
				`authority=${JSON.stringify(afterAuthority)}`,
			),
		).toBe(true);
	},
);
