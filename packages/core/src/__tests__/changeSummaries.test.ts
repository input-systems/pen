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
			sourceParentId: null,
			sourceIndex: 1,
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

});

const inserted = (blockId: string, parentId: string | null, index: number) =>
	({ type: "block-inserted", blockId, parentId, index }) as const;
const removed = (blockId: string, parentId: string | null, index: number) =>
	({ type: "block-removed", blockId, parentId, index }) as const;
const moved = (
	blockId: string,
	[fromParentId, fromIndex]: [string | null, number],
	[toParentId, toIndex]: [string | null, number],
) => ({ type: "block-moved", blockId, fromParentId, fromIndex, toParentId, toIndex }) as const;

/** An index whose roots are paragraphs unless `typeById` says otherwise. */
function structuralIndex(
	roots: string[],
	typeById: Record<string, string> = {},
	children: [string, string[]][] = [],
) {
	return createBlockIndexSnapshot({
		roots,
		typeById: { ...Object.fromEntries(roots.map((id) => [id, "paragraph"])), ...typeById },
		...(children.length > 0 && {
			childrenByParentId: new Map<string | null, readonly string[]>([[null, roots], ...children]),
		}),
	});
}

describe("removed subtrees", () => {
	it("SCALE2: removing a block reports its children-array descendants removed, except those re-homed", () => {
		const index = structuralIndex(["t", "b"], { t: "toggle", c1: "paragraph", c2: "toggle", g: "paragraph" }, [
			["t", ["c1", "c2"]],
			["c2", ["g"]],
		]);
		const summary = buildChangeSummary(
			emptyDelta({ blockOrderDelta: [{ delete: 1 }, { retain: 1 }, { insert: ["c1"] }] }),
			index,
			1,
		);
		expect(summary.structural.filter((change) => change.type === "block-removed")).toEqual([
			removed("t", null, 0),
			removed("c2", "t", 1),
			removed("g", "c2", 0),
		]);
		expect([...summary.affectedBlockIds].sort()).toEqual(["c1", "c2", "g", "t"]);
	});

	it("COL4: removing one of a block's duplicate entries reports a move to the surviving entry", () => {
		// An undo or remote commit can leave `a` listed twice; the repair
		// removes one entry and the block stays in the document, at the other.
		const index = structuralIndex(["a", "b", "a"]);
		const structuralFor = (blockOrderDelta: RawCommitDelta["blockOrderDelta"]) =>
			buildChangeSummary(emptyDelta({ blockOrderDelta }), index, 1).structural;

		expect(structuralFor([{ retain: 2 }, { delete: 1 }])).toEqual([moved("a", [null, 0], [null, 0])]);
		expect(structuralFor([{ delete: 1 }])).toEqual([moved("a", [null, 0], [null, 1])]);
		expect(structuralFor([{ delete: 1 }, { retain: 1 }, { delete: 1 }])).toEqual([removed("a", null, 0)]);
	});

	it("SCALE2: a move whose pre- and post-commit indexes coincide is still reported", () => {
		// `d` moves before `c` while `x` is inserted ahead of both: its old
		// index (3) equals its new one, but its neighbours changed.
		const summary = buildChangeSummary(
			emptyDelta({
				blockOrderDelta: [
					{ retain: 1 },
					{ insert: ["x"] },
					{ retain: 1 },
					{ insert: ["d"] },
					{ retain: 1 },
					{ delete: 1 },
				],
				blockMapChanges: new Map([["x", new Set<string>()]]),
			}),
			structuralIndex(["a", "b", "c", "d"]),
			1,
		);
		expect(summary.structural).toEqual([inserted("x", null, 1), moved("d", [null, 3], [null, 3])]);
	});

	it("COL4: an inserted entry whose block map is gone is reported removed, not inserted", () => {
		// An undo restores `x`'s order entry after a peer deleted its map.
		const asked: string[] = [];
		const summary = buildChangeSummary(
			emptyDelta({
				blockOrderDelta: [{ retain: 1 }, { insert: ["x", "y"] }],
				blockMapChanges: new Map([["y", new Set<string>()]]),
			}),
			structuralIndex(["a"]),
			1,
			{
				blockExists: (blockId) => {
					asked.push(blockId);
					return blockId !== "x";
				},
			},
		);
		expect(summary.structural).toEqual([inserted("y", null, 2), removed("x", null, 1)]);
		// `y`'s map arrived with it, so only `x` is looked up.
		expect(asked).toEqual(["x"]);
	});

	it("COL4: a block map arriving for an entry an array already lists is reported inserted there", () => {
		// `c`'s entry in `t` outlived its map (a peer moved it there while an
		// undo deleted the block); a redo restores the map.
		const summary = buildChangeSummary(
			emptyDelta({ blockMapChanges: new Map([["c", new Set<string>()]]) }),
			structuralIndex(["t"], { t: "toggle" }, [["t", ["a", "c"]]]),
			1,
			{ blockExists: () => true },
		);
		expect(summary.structural).toEqual([inserted("c", "t", 1)]);
	});

	it("COL4: removing a block's entry from one of two arrays reports it moved to the other", () => {
		// Concurrent moves listed `b` at the root and in `t`'s array; the
		// repair removes the root entry and the block renders under `t`.
		const summary = buildChangeSummary(
			emptyDelta({ blockOrderDelta: [{ retain: 1 }, { delete: 1 }] }),
			structuralIndex(["a", "b", "t"], { t: "toggle" }, [["t", ["b"]]]),
			1,
		);
		expect(summary.structural).toEqual([moved("b", [null, 1], ["t", 0])]);
	});

	it("SCALE2: inserting a block with a children array reports its descendants, as inserts or as moves", () => {
		// An undo restoring a deleted toggle: its array arrives inside the new
		// block map, so no array edit names `c1`, `c2` or `g`; `b` sat at the
		// root before and was re-homed into the restored toggle.
		const summary = buildChangeSummary(
			emptyDelta({
				blockOrderDelta: [{ retain: 1 }, { insert: ["t"] }, { delete: 1 }],
				arrivedChildArrays: new Map<string, readonly string[]>([
					["t", ["c1", "c2", "b"]],
					["c2", ["g"]],
				]),
			}),
			structuralIndex(["a", "b"]),
			1,
		);
		expect(summary.structural).toEqual([
			inserted("t", null, 1),
			inserted("c1", "t", 0),
			inserted("c2", "t", 1),
			inserted("g", "c2", 0),
			moved("b", [null, 1], ["t", 2]),
		]);
		expect([...summary.affectedBlockIds].sort()).toEqual(["b", "c1", "c2", "g", "t"]);
	});
});
