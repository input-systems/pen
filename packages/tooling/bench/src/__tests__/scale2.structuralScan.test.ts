import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applySplitBlock } from "@input/pen-core";
import {
	createScanProbe,
	createTestEditor,
	createTwoPeerHarness,
	generateMixedBlockSpecs,
	mixedFixtureOps,
	mixedFixtureTargets,
	type ScanCounts,
} from "@input/pen-test";
import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

/**
 * SCALE2 structural commits (W2.G5): an Enter and a peer's block insert read
 * the text of no block they do not name, and stay linear in block count.
 * Pinned in baselines/scale2-structural.counts.json; record with
 * RECORD_SCALE2_STRUCTURAL=1 SCALE2_STRUCTURAL_REASON="…".
 */
const SIZES = [100, 1_000, 5_000] as const;
const WARMUP = 2;
const LINEAR_RATIO = 5.5;
const BASELINE_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../baselines/scale2-structural.counts.json",
);

type Action = "enter" | "remoteInsert";
type Points = Record<`${Action}.${(typeof SIZES)[number]}`, ScanCounts>;

interface StructuralBaseline {
	readonly schemaVersion: 1;
	readonly rule: "SCALE2";
	readonly points: Points;
	readonly history: readonly { readonly date: string; readonly reason: string }[];
}

function measureEnter(rootCount: number): ScanCounts {
	const editor = createTestEditor({ blocks: generateMixedBlockSpecs(rootCount) });
	editor.apply(mixedFixtureOps(rootCount), { origin: "system" });
	const { paragraph } = mixedFixtureTargets(rootCount);
	const split = (index: number) =>
		applySplitBlock(editor, {
			blockId: paragraph,
			offset: editor.getBlock(paragraph)?.textContent().length ?? 0,
			newBlockId: `enter-${index}`,
			applyOptions: { origin: "user" },
		});
	for (let rep = 0; rep < WARMUP; rep += 1) split(rep);
	const probe = createScanProbe(editor);
	try {
		probe.reset();
		split(WARMUP);
		return probe.snapshot();
	} finally {
		probe.dispose();
		editor.destroy();
	}
}

function revisions(editor: Editor): Map<string, number> {
	return new Map(
		editor.documentState.preorderBlockIds().map((id) => [id, editor.getBlockRevision(id)]),
	);
}

function measureRemoteInsert(rootCount: number): ScanCounts {
	const harness = createTwoPeerHarness({
		blocks: generateMixedBlockSpecs(rootCount),
		prepare: (seed) => seed.apply(mixedFixtureOps(rootCount), { origin: "system" }),
	});
	const local = harness.peerA.editor;
	const { insertAfter } = mixedFixtureTargets(rootCount);
	const insert = (index: number) => {
		harness.peerB.editor.apply(
			[{ type: "insert-block", blockId: `remote-${index}`, blockType: "paragraph", props: {}, position: { after: insertAfter } }],
			{ origin: "user" },
		);
		harness.applyUpdateTo("a", harness.encodeUpdateFrom("b"));
	};
	for (let rep = 0; rep < WARMUP; rep += 1) insert(rep);
	const before = revisions(local);
	let affected: readonly string[] = [];
	const off = local.on("commit", (event) => {
		affected = event.summary.affectedBlockIds;
	});
	const probe = createScanProbe(local);
	try {
		probe.reset();
		insert(WARMUP);
		const counts = probe.snapshot();
		expect(affected).toEqual([`remote-${WARMUP}`]);
		const bumped = [...before].filter(([id, revision]) => local.getBlockRevision(id) !== revision);
		expect(bumped, "a peer's insert bumps no existing block's revision").toEqual([]);
		return counts;
	} finally {
		probe.dispose();
		off();
		harness.destroy();
	}
}

function scanned(counts: ScanCounts): number {
	return counts.blockOrderReads + counts.blocksMapIterations + counts.orderArrayReads;
}

function loadBaseline(): StructuralBaseline | null {
	return existsSync(BASELINE_PATH)
		? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as StructuralBaseline)
		: null;
}

describe("SCALE2 structural commits", () => {
	it("SCALE2: a structural commit reads no unrelated text and stays linear", () => {
		const points = {} as Points;
		for (const size of SIZES) {
			points[`enter.${size}`] = measureEnter(size);
			points[`remoteInsert.${size}`] = measureRemoteInsert(size);
		}
		for (const action of ["enter", "remoteInsert"] as const) {
			const small = points[`${action}.100`];
			expect(points[`${action}.1000`].textFullReads, action).toBe(small.textFullReads);
			expect(points[`${action}.5000`].textFullReads, action).toBe(small.textFullReads);
			expect(scanned(points[`${action}.5000`]), action).toBeLessThanOrEqual(
				LINEAR_RATIO * scanned(points[`${action}.1000`]),
			);
		}
		if (process.env.RECORD_SCALE2_STRUCTURAL === "1") {
			const reason = process.env.SCALE2_STRUCTURAL_REASON;
			if (!reason) throw new Error("RECORD_SCALE2_STRUCTURAL needs SCALE2_STRUCTURAL_REASON");
			const baseline: StructuralBaseline = {
				schemaVersion: 1,
				rule: "SCALE2",
				points,
				history: [...(loadBaseline()?.history ?? []), { date: new Date().toISOString().slice(0, 10), reason }],
			};
			writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, "\t")}\n`);
			return;
		}
		const baseline = loadBaseline();
		expect(baseline, "SCALE2_STRUCTURAL_BASELINE_MISSING").not.toBeNull();
		expect(points).toEqual(baseline?.points);
	}, 300_000);
});
