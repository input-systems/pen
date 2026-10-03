import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ENVELOPE_SAMPLE_SIZE, SCALE1_MEASUREMENTS } from "../constants/scale1";
import { envelopeTablePath, loadCommittedEnvelope } from "../envelope/compare";
import { buildRendererRows } from "../envelope/importRenderer";
import { renderEnvelopeMarkdown } from "../envelope/table";
import {
	assertEnforcementInventoryCoversFixtures,
	assertNoUnitClockGates,
} from "../envelope/enforcement";
import { RELATED_FIXTURE_AUDIT, SCALE1_FIXTURE_AUDIT } from "../fixtures/audit";

describe("SCALE1 generated envelope table", () => {
	it("SCALE1: committed table is generated from the envelope record", async () => {
		const record = await loadCommittedEnvelope();
		const committed = await readFile(envelopeTablePath(), "utf8");
		expect(committed).toBe(renderEnvelopeMarkdown(record));
	});

	it("SCALE1: table states the fixture audit and the harness floor per rung", async () => {
		const record = await loadCommittedEnvelope();
		const markdown = renderEnvelopeMarkdown(record);

		for (const spec of SCALE1_MEASUREMENTS) {
			expect(markdown).toContain(`\`${spec.id}\``);
		}
		for (const row of [...SCALE1_FIXTURE_AUDIT, ...RELATED_FIXTURE_AUDIT]) {
			expect(markdown).toContain(row.verdict);
			expect(markdown).toContain(row.howMeasured);
		}
		for (const point of record.points) {
			expect(markdown).toContain(point.floorKind);
			expect(Number.isFinite(point.floorP50Ms)).toBe(true);
			expect(point.attributedP50Ms).toBe(
				Math.round(
					Math.max(0, point.measuredP50Ms - point.floorP50Ms) * 100,
				) / 100,
			);
		}

		expect(record.sampleSize).toBe(ENVELOPE_SAMPLE_SIZE);
		expect(record.points).toHaveLength(SCALE1_MEASUREMENTS.length);
		// A load-taken record is provisional; a quiet one is the envelope.
		expect(record.status).toBe(record.loadTaken ? "provisional" : "envelope");
	});

	it("SCALE1: enforcement inventory covers every fixture and has no unit clock gates", () => {
		expect(() => assertEnforcementInventoryCoversFixtures()).not.toThrow();
		expect(() => assertNoUnitClockGates()).not.toThrow();
	});

	it("SCALE1: block-count ladder has three rungs so the curve is visible", async () => {
		const record = await loadCommittedEnvelope();
		const blocks = record.points.filter(
			(point) => point.axis === "blockCount",
		);
		expect(blocks.map((point) => point.id)).toEqual([
			"blocks-100",
			"blocks-1000",
			"blocks-5000",
		]);
		expect(blocks.map((point) => point.count)).toEqual([100, 1000, 5000]);
		expect(blocks[0]!.count).toBeLessThan(blocks[1]!.count);
		expect(blocks[1]!.count).toBeLessThan(blocks[2]!.count);
	});

	it("SCALE1: the Renderer section has one measured row per surface at 1k, 5k, 10k and 50k", async () => {
		const record = await loadCommittedEnvelope();
		const ids = record.renderer.map((row) => row.id).sort();
		const expected = ["react", "vue", "vanilla"]
			.flatMap((surface) =>
				["1k", "5k", "10k", "50k"].map((size) => `renderer.${surface}.${size}`),
			)
			.sort();
		expect(ids).toEqual(expected);
		expect(record.renderer.every((row) => row.grade === "measured")).toBe(true);
		const markdown = renderEnvelopeMarkdown(record);
		expect(markdown).toContain("## Renderer");
		expect(markdown).not.toContain("No renderer suite yet asserts these sizes.");
	});

	it("SCALE1: committed renderer rows are generated from the conformance scale-render baselines", async () => {
		const record = await loadCommittedEnvelope();
		expect(record.renderer).toEqual(await buildRendererRows());
	});
});
