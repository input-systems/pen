import { expect, test } from "@playwright/test";
import { caretCacheHolds } from "../../harness/src/geometryCompare";
import { formatCheckReport } from "../../src/checkReport";
import { scenario } from "../../src/scenario";
import { sampleCaretPoints } from "../../src/g5Geometry";
import { logLoad } from "../../src/specHelpers";

scenario(
	"G2: caretRect compare after a click counts MISSING as well as STALE (both-null is not a hold)",
	async (s) => {
		const loads = logLoad("geometry-cache");
		await s.load("hello-world");
		await s.geometry.invalidate();
		const points = sampleCaretPoints(await s.geometry.blocks());
		expect(
			points.length,
			formatCheckReport(
				"geometry: hello-world produced caret sample points",
				points.length > 0 ? "passed" : "skipped",
				points.length > 0 ? undefined : "no geometry blocks",
			),
		).toBeGreaterThan(0);

		const compare = await s.geometry.compare(points);
		await test.info().attach("g1-caret-cache", {
			body: JSON.stringify({ loadavg: loads, compare }, null, 2),
			contentType: "application/json",
		});

		expect(
			compare.compares.length,
			formatCheckReport(
				"geometry: compare produced entries",
				compare.compares.length > 0 ? "passed" : "skipped",
				compare.compares.length > 0
					? undefined
					: "compareCaretCache returned no entries — unchecked, not a hold",
			),
		).toBeGreaterThan(0);
		expect(
			compare.missingCount,
			formatCheckReport(
				"geometry: missing caretRects (both-null is missing, not equal)",
				compare.missingCount === 0 ? "passed" : "failed",
				`missing=${compare.missingCount} stale=${compare.staleCount} entries=${compare.compares.length}`,
			),
		).toBe(0);
		expect(
			compare.staleCount,
			formatCheckReport(
				"geometry: stale caretRects",
				compare.staleCount === 0 ? "passed" : "failed",
				`stale=${compare.staleCount}`,
			),
		).toBe(0);
		expect(
			caretCacheHolds(compare),
			formatCheckReport(
				"geometry: caretCacheHolds requires missing=0 and stale=0",
				caretCacheHolds(compare) ? "passed" : "failed",
			),
		).toBe(true);
		expect(
			caretCacheHolds({ staleCount: 0, missingCount: 1 }),
			formatCheckReport(
				"geometry: both-null / missingCount=1 cannot hold",
				"passed",
				"predicate control: rectsEqual(null,null) must not keep this green",
			),
		).toBe(false);
	},
);
