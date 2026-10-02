import { expect } from "@playwright/test";
import { scenario } from "../../src/scenario";
import { divergenceRestoreHolds } from "../../src/selectionRecordCheck";

scenario(
	"R1 I4: a stray selectionchange after a cancelled drag is refused and re-projected",
	async (s, page) => {
		await s.load("hello-world");
		await s.selectText(0, 5);

		const prevented = await page.evaluate(() => {
			const inline = document.querySelector("[data-pen-inline-content]");
			const event = new DragEvent("dragstart", {
				bubbles: true,
				cancelable: true,
			});
			inline?.dispatchEvent(event);
			return event.defaultPrevented;
		});
		expect(prevented, "R1: the field cancels a native dragstart").toBe(true);

		const before = await page.evaluate(
			() => window.__penConformance.selectionRecord,
		);
		const forced = await s.forceUnwindowedDomDivergence();
		expect(forced.created, forced.reason).toBe(true);

		await expect
			.poll(async () => {
				const after = await page.evaluate(
					() => window.__penConformance.selectionRecord,
				);
				const compare = await page.evaluate(() =>
					window.__penConformance.domMatchesAuthority(),
				);
				const hold = divergenceRestoreHolds({
					focused: forced.focused,
					createdDivergence: forced.created,
					beforeVersion: before!.version,
					afterVersion: after?.version ?? null,
					compare,
				});
				return hold.ok ? "restored" : (hold.reason ?? "mismatch");
			})
			.toBe("restored");
	},
);
