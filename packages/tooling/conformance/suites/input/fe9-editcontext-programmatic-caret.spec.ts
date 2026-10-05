import { expect, test } from "@playwright/test";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { readBackend, readDocumentText } from "./keys";

scenario(
	"FE9: a host selectText after typing moves the next EditContext keystroke to the new caret",
	async (s, page) => {
		test.skip(
			test.info().project.name !== "chromium",
			"FE9 is the EditContext textupdate sensor; Chromium only",
		);

		await s.load("hello-world");
		await s.selectText(0, 5);

		const backend = await readBackend(page);
		expect(backend.hasEditContext).toBe(true);

		// The keystroke leaves a trusted typing caret at 6.
		await page.keyboard.type("x");
		expect(await readDocumentText(page)).toContain("Hellox world");

		// A programmatic write supersedes it; the next keystroke lands at 2.
		await s.selectText(0, 2);
		await page.keyboard.type("y");
		const text = await readDocumentText(page);

		expect(
			text.includes("Heyllox world"),
			formatCheckReport(
				"FE9: typed character lands at the programmatic caret",
				text.includes("Heyllox world") ? "passed" : "failed",
				`text=${JSON.stringify(text)}`,
			),
		).toBe(true);
		await s.assert.domMatchesAuthority();
	},
);
