import { expect, type Page } from "@playwright/test";
import {
	GRAPHEME_ZWJ_AFTER,
	GRAPHEME_ZWJ_ID,
	GRAPHEME_ZWJ_LINE,
} from "../../fixtures/grapheme";
import { graphemeWalkHolds } from "../../src/graphemeBoundaries";
import { scenario } from "../../src/scenario";
import {
	caretShiftHolds,
	divergenceRestoreHolds,
	monotonicHolds,
	originHolds,
	recordPresence,
} from "../../src/selectionRecordCheck";
import { formatCheckReport } from "../../src/checkReport";
import { standingAuthorityHolds } from "../../src/standingFilter";
import type { SerializedSelectionRecord } from "../../src/types";
import { clickOffset } from "../../src/specHelpers";

async function readRecord(page: Page): Promise<SerializedSelectionRecord | null> {
	return page.evaluate(() => window.__penConformance.selectionRecord);
}

scenario(
	"I4: closed-window DOM divergence is restored without writing the authority",
	async (s, page) => {
		await s.load("hello-world");
		await s.selectText(0, 5);
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 5 },
			focus: { blockId: "hello-p1", offset: 5 },
		});

		const before = await readRecord(page);
		expect(
			recordPresence(before),
			formatCheckReport(
				"I4: selectionRecord before the force",
				before ? "passed" : "skipped",
				before ? undefined : "selectionRecord is not available",
			),
		).toBe("present");

		const forced = await s.forceUnwindowedDomDivergence();
		expect(
			forced.focused ? "focused" : "unfocused",
			formatCheckReport(
				"I4: editor focused for the force",
				forced.focused ? "passed" : "skipped",
				forced.reason,
			),
		).toBe("focused");
		expect(
			forced.created ? "diverged" : "could-not-diverge",
			formatCheckReport(
				"I4: native write left the authority",
				forced.created ? "passed" : "skipped",
				forced.reason,
			),
		).toBe("diverged");

		await expect
			.poll(async () => {
				const after = await readRecord(page);
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
				if (hold.skipped === true) {
					return "unchecked";
				}
				return hold.ok ? "matched" : "mismatch";
			})
			.toBe("matched");

		const after = await readRecord(page);
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
		expect(
			hold.skipped === true ? "unchecked" : "checked",
			formatCheckReport(
				"I4: restore was checkable",
				hold.skipped ? "skipped" : "passed",
				hold.reason,
			),
		).toBe("checked");
		expect(
			hold.ok,
			formatCheckReport(
				"I4: DOM restored and version unchanged",
				hold.ok ? "passed" : "failed",
				hold.reason,
			),
		).toBe(true);
	},
);

scenario(
	"P1: programmatic selectText is projected so DOM matches the new version",
	async (s, page) => {
		await s.load("hello-world");
		await clickOffset(page, "hello-p1", 2);
		await s.assert.selectionEquals({
			anchor: { blockId: "hello-p1", offset: 2 },
			focus: { blockId: "hello-p1", offset: 2 },
		});
		const before = await readRecord(page);
		expect(
			recordPresence(before),
			formatCheckReport(
				"P1: selectionRecord before selectText",
				before ? "passed" : "skipped",
				before ? undefined : "selectionRecord is not available",
			),
		).toBe("present");

		await s.selectText(0, 8);

		await expect
			.poll(async () => {
				const selection = await page.evaluate(
					() => window.__penConformance.selection,
				);
				if (selection?.type !== "text") {
					return "not-text";
				}
				return `${selection.focus.blockId}:${selection.focus.offset}`;
			})
			.toBe("hello-p1:8");

		const after = await readRecord(page);
		expect(
			recordPresence(after),
			formatCheckReport(
				"P1: selectionRecord after selectText",
				after ? "passed" : "skipped",
				after ? undefined : "selectionRecord is not available",
			),
		).toBe("present");
		expect(
			after!.version,
			formatCheckReport(
				"P1: version advanced",
				after!.version > before!.version ? "passed" : "failed",
				`version ${before!.version} → ${after!.version}`,
			),
		).toBeGreaterThan(before!.version);

		const compare = await page.evaluate(() =>
			window.__penConformance.domMatchesAuthority(),
		);
		expect(
			standingAuthorityHolds(compare),
			formatCheckReport(
				"P1: DOM matches authority after version bump",
				standingAuthorityHolds(compare)
					? "passed"
					: compare.skipped
						? "skipped"
						: "failed",
				compare.reason,
			),
		).toBe(true);
	},
);

scenario(
	"S3: a commit that remaps the caret writes origin mapped; selectText writes programmatic",
	async (s, page) => {
		await s.load("hello-world");
		await s.selectText(0, 5);

		const afterSelect = await readRecord(page);
		const programmatic = originHolds(afterSelect, "programmatic");
		expect(
			programmatic.skipped === true ? "unchecked" : "checked",
			formatCheckReport(
				"S3: programmatic origin readable",
				programmatic.skipped ? "skipped" : "passed",
				programmatic.reason,
			),
		).toBe("checked");
		expect(
			programmatic.ok,
			formatCheckReport(
				"S3: selectText origin",
				programmatic.ok ? "passed" : "failed",
				programmatic.reason,
			),
		).toBe(true);

		// Local apply, not remoteSplice: a Yjs peer insert updates the
		// document ("XHello") without an onCommit remap on this tree.
		// S3 needs a remapping write; A5's local-apply path is the one
		// that actually moves the caret and stamps origin mapped.
		await page.evaluate(() => {
			const blockId = window.__penConformance.blockIds[0];
			if (!blockId) {
				throw new Error("S3: hello-world has no first block");
			}
			window.__penConformance.apply([
				{
					type: "splice-text",
					blockId,
					from: 0,
				to: 0,
				insert: "X",
				},
			]);
		});
		await expect
			.poll(() =>
				page.evaluate(() => window.__penConformance.documentText),
			)
			.toContain("XHello");

		const afterMap = await readRecord(page);
		const shifted = caretShiftHolds(afterSelect, afterMap, 6);
		expect(
			shifted.skipped === true ? "unchecked" : "checked",
			formatCheckReport(
				"S3: remapping commit was checkable",
				shifted.skipped ? "skipped" : "passed",
				shifted.reason,
			),
		).toBe("checked");
		expect(
			shifted.ok,
			formatCheckReport(
				"S3: caret remapped past the insert",
				shifted.ok ? "passed" : "failed",
				shifted.reason,
			),
		).toBe(true);
		const mapped = originHolds(afterMap, "mapped");
		expect(
			mapped.skipped === true ? "unchecked" : "checked",
			formatCheckReport(
				"S3: mapped origin readable",
				mapped.skipped ? "skipped" : "passed",
				mapped.reason,
			),
		).toBe("checked");
		expect(
			mapped.ok,
			formatCheckReport(
				"S3: remapped caret origin",
				mapped.ok ? "passed" : "failed",
				mapped.reason,
			),
		).toBe(true);
	},
);

scenario(
	"S5: arrow walk across a ZWJ family lands only on grapheme boundaries",
	async (s, page) => {
		await s.load("grapheme-clusters");
		await clickOffset(page, GRAPHEME_ZWJ_ID, 0);
		await s.assert.selectionEquals({
			anchor: { blockId: GRAPHEME_ZWJ_ID, offset: 0 },
			focus: { blockId: GRAPHEME_ZWJ_ID, offset: 0 },
		});

		const offsets: number[] = [0];
		for (let step = 0; step < GRAPHEME_ZWJ_LINE.length + 2; step += 1) {
			await s.keyboard.press("ArrowRight");
			const selection = await page.evaluate(
				() => window.__penConformance.selection,
			);
			if (selection?.type !== "text") {
				break;
			}
			if (selection.focus.blockId !== GRAPHEME_ZWJ_ID) {
				break;
			}
			offsets.push(selection.focus.offset);
			if (selection.focus.offset >= GRAPHEME_ZWJ_LINE.length) {
				break;
			}
		}

		const walk = graphemeWalkHolds({
			text: GRAPHEME_ZWJ_LINE,
			offsets,
			mustVisit: GRAPHEME_ZWJ_AFTER,
		});
		expect(
			walk.skipped === true ? "unchecked" : "checked",
			formatCheckReport(
				"S5: grapheme walk was checkable",
				walk.skipped ? "skipped" : "passed",
				walk.reason,
			),
		).toBe("checked");
		expect(
			walk.ok,
			formatCheckReport(
				"S5: caret stayed on grapheme boundaries",
				walk.ok ? "passed" : "failed",
				walk.reason,
			),
		).toBe(true);
	},
);

scenario(
	"S6: selectionRecord version and commitId never decrease across select, type, and remote splice",
	async (s, page) => {
		await s.load("hello-world");
		const samples: { version: number; commitId: number }[] = [];

		async function sample(label: string): Promise<void> {
			const record = await readRecord(page);
			expect(
				recordPresence(record),
				formatCheckReport(
					`S6: ${label} record readable`,
					record ? "passed" : "skipped",
					record ? undefined : "selectionRecord is not available",
				),
			).toBe("present");
			samples.push({
				version: record!.version,
				commitId: record!.commitId,
			});
		}

		await sample("after load");
		await s.selectText(0, 8);
		await sample("after selectText");
		await s.keyboard.type("Z");
		await sample("after type");
		await page.evaluate(() => {
			window.__penConformance.remoteSplice({
				block: 0,
				from: 0,
				to: 0,
				insert: "Q",
			});
		});
		await expect
			.poll(() =>
				page.evaluate(() => window.__penConformance.documentText),
			)
			.toContain("Q");
		await sample("after remote splice");

		const hold = monotonicHolds(samples);
		expect(
			hold.skipped === true ? "unchecked" : "checked",
			formatCheckReport(
				"S6: monotonic walk was checkable",
				hold.skipped ? "skipped" : "passed",
				hold.reason,
			),
		).toBe("checked");
		expect(
			hold.ok,
			formatCheckReport(
				"S6: version and commitId never decreased",
				hold.ok ? "passed" : "failed",
				hold.reason,
			),
		).toBe(true);
	},
);
