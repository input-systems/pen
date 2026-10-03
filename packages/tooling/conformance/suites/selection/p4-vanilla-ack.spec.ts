import { expect } from "@playwright/test";
import { scenario } from "../../src/scenario";

for (const surface of ["vanilla", "react", "vue"] as const) {
	scenario(
		`P4: on the ${surface} surface a block inserted and selected in one turn is projected once it mounts`,
		async (s, page) => {
			await s.load("hello-world");
			await page.evaluate(() => window.__penConformance.focusText(0));

			await page.evaluate(() => {
				const harness = window.__penConformance;
				harness.apply([
					{
						type: "insert-block",
						blockId: "p4-added",
						blockType: "paragraph",
						props: {},
						position: "last",
					},
					{
						type: "splice-text",
						blockId: "p4-added",
						from: 0,
						to: 0,
						insert: "added",
					},
				]);
				harness.selectTextById("p4-added", 3, 3);
			});

			await expect
				.poll(async () => {
					const check = await page.evaluate(() =>
						window.__penConformance.domMatchesAuthority(),
					);
					return check.ok ? "ok" : (check.reason ?? "mismatch");
				})
				.toBe("ok");
			const record = await page.evaluate(
				() => window.__penConformance.selectionRecord,
			);
			expect(record?.state).toMatchObject({
				type: "text",
				anchor: { blockId: "p4-added", offset: 3 },
			});
		},
		{ url: `/?surface=${surface}` },
	);
}
