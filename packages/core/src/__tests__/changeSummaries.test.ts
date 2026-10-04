import {
	createSummarySource,
	initBlockMap,
	yjsAdapter,
	type RawCommitDelta,
	type YjsCRDTDocument,
	type YTextDelta,
} from "@input/pen-yjs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
	createBlockIndexSnapshot,
	emptyBlockIndexSnapshot,
} from "../changes/blockIndex";
import { buildChangeSummary } from "../changes/summaryBuilder";
import type { StructuralChange } from "../changes/types";

const MEADOW = "meadow sage";

function meadowIndex() {
	return createBlockIndexSnapshot({
		roots: ["b1"],
		lengthById: { b1: MEADOW.length },
		typeById: { b1: "paragraph" },
	});
}

function textDeltaMap(
	...entries: [string, YTextDelta][]
): Map<string, YTextDelta[]> {
	return new Map(entries.map(([blockId, delta]) => [blockId, [delta]]));
}

function emptyDelta(overrides: Partial<RawCommitDelta> = {}): RawCommitDelta {
	return {
		originTag: "user",
		textDeltas: new Map(),
		blockOrderDelta: [],
		childArrayDeltas: new Map(),
		blockMapChanges: new Map(),
		appChanges: new Set(),
		metadataChanges: new Set(),
		...overrides,
	};
}

describe("change summaries — structural variants", () => {
	it("OB1: emits all nine StructuralChange variants from the builder", () => {
		const index = createBlockIndexSnapshot({
			roots: ["b1", "b2", "table"],
			lengthById: { b1: 6, b2: 5, table: 0 },
			typeById: {
				b1: "paragraph",
				b2: "paragraph",
				table: "table",
			},
		});

		const inserted = buildChangeSummary(
			emptyDelta({
				blockOrderDelta: [{ retain: 3 }, { insert: ["b3"] }],
				blockMapChanges: new Map([["b3", new Set()]]),
			}),
			index,
			1,
		);
		expect(inserted.structural).toContainEqual({
			type: "block-inserted",
			blockId: "b3",
			parentId: null,
			index: 3,
		});

		const removed = buildChangeSummary(
			emptyDelta({
				blockOrderDelta: [{ retain: 1 }, { delete: 1 }],
			}),
			index,
			2,
		);
		expect(removed.structural).toContainEqual({
			type: "block-removed",
			blockId: "b2",
			parentId: null,
			index: 1,
		});

		const moved = buildChangeSummary(
			emptyDelta({
				blockOrderDelta: [
					{ insert: ["b2"] },
					{ retain: 1 },
					{ delete: 1 },
				],
			}),
			index,
			3,
		);
		expect(
			moved.structural.some((change) => change.type === "block-moved"),
		).toBe(true);

		const converted = buildChangeSummary(
			emptyDelta({
				blockMapChanges: new Map([["b1", new Set(["type"])]]),
			}),
			index,
			4,
		);
		expect(converted.structural).toContainEqual({
			type: "block-props-changed",
			blockId: "b1",
			keys: ["type"],
		});

		const props = buildChangeSummary(
			emptyDelta({
				blockMapChanges: new Map([["b1", new Set(["align"])]]),
			}),
			index,
			5,
		);
		expect(props.structural).toContainEqual({
			type: "block-props-changed",
			blockId: "b1",
			keys: ["align"],
		});

		const split = buildChangeSummary(
			emptyDelta({
				originTag: {
					type: "user",
					structural: {
						kind: "split",
						blockId: "b1",
						newBlockId: "b9",
						offset: 3,
					},
				},
				blockOrderDelta: [{ retain: 1 }, { insert: ["b9"] }],
				blockMapChanges: new Map([["b9", new Set()]]),
			}),
			index,
			6,
		);
		expect(split.structural).toContainEqual({
			type: "block-split",
			blockId: "b1",
			newBlockId: "b9",
			offset: 3,
		});
		expect(
			split.structural.some((change) => change.type === "block-inserted"),
		).toBe(false);

		const merged = buildChangeSummary(
			emptyDelta({
				originTag: {
					type: "user",
					structural: {
						kind: "merge",
						targetBlockId: "b1",
						sourceBlockId: "b2",
					},
				},
				blockOrderDelta: [{ retain: 1 }, { delete: 1 }],
			}),
			index,
			7,
		);
		expect(merged.structural).toContainEqual({
			type: "blocks-merged",
			targetBlockId: "b1",
			sourceBlockId: "b2",
			joinOffset: 6,
		});
		expect(
			merged.structural.some((change) => change.type === "block-removed"),
		).toBe(false);

		const table = buildChangeSummary(
			emptyDelta({
				blockMapChanges: new Map([
					["table", new Set(["tableColumns"])],
				]),
			}),
			index,
			8,
		);
		expect(table.structural).toContainEqual({
			type: "table-changed",
			blockId: "table",
		});

		const apps = buildChangeSummary(
			emptyDelta({ appChanges: new Set(["app-1"]) }),
			index,
			9,
		);
		expect(apps.structural).toContainEqual({
			type: "apps-changed",
			appIds: ["app-1"],
		});

		const metadata = buildChangeSummary(
			emptyDelta({ metadataChanges: new Set(["title"]) }),
			index,
			10,
		);
		expect(metadata.structural).toContainEqual({
			type: "metadata-changed",
			namespaces: ["title"],
		});

		const nine: StructuralChange["type"][] = [
			"block-inserted",
			"block-removed",
			"block-moved",
			"block-props-changed",
			"block-split",
			"blocks-merged",
			"table-changed",
			"apps-changed",
			"metadata-changed",
		];
		expect(nine).toHaveLength(9);
		for (const type of nine) {
			assertNineStructuralVariants(type);
		}
	});
});

function assertNineStructuralVariants(type: StructuralChange["type"]): void {
	switch (type) {
		case "block-inserted":
		case "block-removed":
		case "block-moved":
		case "block-props-changed":
		case "block-split":
		case "blocks-merged":
		case "table-changed":
		case "apps-changed":
		case "metadata-changed":
			return;
		default: {
			const _exhaustive: never = type;
			return _exhaustive;
		}
	}
}

describe("change summaries — empty-block inserts (EM5)", () => {
	it("EM5: emptying a block leaves no insertLength artifact", () => {
		const summary = buildChangeSummary(
			emptyDelta({
				textDeltas: textDeltaMap(["b1", [{ delete: MEADOW.length }]]),
			}),
			meadowIndex(),
			1,
		);
		expect(summary.blockText).toEqual([
			{
				blockId: "b1",
				splices: [{ from: 0, to: MEADOW.length, insertLength: 0 }],
				formatRanges: [],
			},
		]);
	});

	it("EM5: typing into an empty block is a logical insert at 0", () => {
		const index = createBlockIndexSnapshot({
			roots: ["b1"],
			lengthById: { b1: 0 },
			typeById: { b1: "paragraph" },
		});
		const summary = buildChangeSummary(
			emptyDelta({
				textDeltas: textDeltaMap(["b1", [{ insert: "a" }]]),
			}),
			index,
			1,
		);
		expect(summary.blockText).toEqual([
			{
				blockId: "b1",
				splices: [{ from: 0, to: 0, insertLength: 1 }],
				formatRanges: [],
			},
		]);
	});

	it("does not drop a nested table-cell delete attributed to a 0-length table", () => {
		const index = createBlockIndexSnapshot({
			roots: ["host4-table"],
			lengthById: { "host4-table": 0 },
			typeById: { "host4-table": "table" },
		});
		const summary = buildChangeSummary(
			emptyDelta({
				textDeltas: textDeltaMap(["host4-table", [{ delete: 11 }]]),
			}),
			index,
			1,
		);
		expect(summary.blockText).toEqual([
			{
				blockId: "host4-table",
				splices: [{ from: 0, to: 11, insertLength: 0 }],
				formatRanges: [],
			},
		]);
		expect(
			summary.blockText.length === 0 && summary.structural.length === 0,
		).toBe(false);
	});

	it("does not drop a one-character nested table-cell delete", () => {
		const index = createBlockIndexSnapshot({
			roots: ["host4-table"],
			lengthById: { "host4-table": 0 },
			typeById: { "host4-table": "table" },
		});
		const summary = buildChangeSummary(
			emptyDelta({
				textDeltas: textDeltaMap(["host4-table", [{ delete: 1 }]]),
			}),
			index,
			1,
		);
		expect(summary.blockText).toEqual([
			{
				blockId: "host4-table",
				splices: [{ from: 0, to: 1, insertLength: 0 }],
				formatRanges: [],
			},
		]);
	});

	it("keeps a nested table-cell insert on a 0-length table", () => {
		const index = createBlockIndexSnapshot({
			roots: ["host4-table"],
			lengthById: { "host4-table": 0 },
			typeById: { "host4-table": "table" },
		});
		const summary = buildChangeSummary(
			emptyDelta({
				textDeltas: textDeltaMap([
					"host4-table",
					[{ insert: "Cell before" }],
				]),
			}),
			index,
			1,
		);
		expect(summary.blockText).toEqual([
			{
				blockId: "host4-table",
				splices: [{ from: 0, to: 0, insertLength: 11 }],
				formatRanges: [],
			},
		]);
	});
});

describe("change summaries — single-code-path", () => {
	it("builder output matches for a local transaction and the same remote update", () => {
		const adapter = yjsAdapter();
		const local = adapter.createDocument() as YjsCRDTDocument;
		local.ydoc.transact(() => {
			initBlockMap(local.penDocument.blocks, "b1", "paragraph", "inline");
			local.penDocument.blockOrder.push(["b1"]);
			(
				local.penDocument.blocks.get("b1")!.get("content") as Y.Text
			).insert(0, MEADOW);
		});
		const remote = adapter.loadDocument(
			adapter.encodeState(local),
		) as YjsCRDTDocument;

		const localDeltas: RawCommitDelta[] = [];
		const remoteDeltas: RawCommitDelta[] = [];
		createSummarySource(local, (delta) => {
			localDeltas.push(delta);
		});
		createSummarySource(remote, (delta) => {
			remoteDeltas.push(delta);
		});

		adapter.transact(local, () => {
			(
				local.penDocument.blocks.get("b1")!.get("content") as Y.Text
			).insert(0, "wild ");
		});
		const update = adapter.encodeUpdate(
			local,
			Y.encodeStateVector(remote.ydoc),
		);
		adapter.applyUpdate(remote, update);

		expect(localDeltas).toHaveLength(1);
		expect(remoteDeltas).toHaveLength(1);

		const index = meadowIndex();
		const localSummary = buildChangeSummary(localDeltas[0]!, index, 1);
		const remoteSummary = buildChangeSummary(remoteDeltas[0]!, index, 1);
		expect(localSummary.blockText).toEqual(remoteSummary.blockText);
		expect(localSummary.structural).toEqual(remoteSummary.structural);
	});
});

describe("change summaries — empty commits", () => {
	it("marks selection-only deltas as empty (no blockText or structural)", () => {
		const summary = buildChangeSummary(
			emptyDelta(),
			emptyBlockIndexSnapshot(),
			1,
		);
		expect(summary.blockText).toEqual([]);
		expect(summary.structural).toEqual([]);
		expect(summary.affectedBlockIds).toEqual([]);
	});

describe("removed subtrees", () => {
	it("SCALE2: removing a block reports its children-array descendants removed, except those re-homed", () => {
		const index = createBlockIndexSnapshot({
			roots: ["t", "b"],
			typeById: { t: "toggle", c1: "paragraph", c2: "toggle", g: "paragraph", b: "paragraph" },
			childrenByParentId: new Map<string | null, readonly string[]>([
				[null, ["t", "b"]],
				["t", ["c1", "c2"]],
				["c2", ["g"]],
			]),
		});
		const summary = buildChangeSummary(
			emptyDelta({ blockOrderDelta: [{ delete: 1 }, { retain: 1 }, { insert: ["c1"] }] }),
			index,
			1,
		);
		const removed = summary.structural.filter((change) => change.type === "block-removed");
		expect(removed).toEqual([
			{ type: "block-removed", blockId: "t", parentId: null, index: 0 },
			{ type: "block-removed", blockId: "c2", parentId: "t", index: 1 },
			{ type: "block-removed", blockId: "g", parentId: "c2", index: 0 },
		]);
		expect([...summary.affectedBlockIds].sort()).toEqual(["c1", "c2", "g", "t"]);
	});
});
});
