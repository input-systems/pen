import type {
	Anchor,
	Assoc,
	CommitEventSource,
	Editor,
} from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { isYjsCRDTDocument } from "@input/pen-yjs";

import {
	applyMergeBlocks,
	applySplitBlock,
	type ContentMove,
	deriveContentMoves,
	repairAnchor,
} from "../index";
import { createEditor as createCoreEditor } from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";

const NIGHTLY = Boolean(process.env.PEN_FUZZ_NIGHTLY);
const SEED_INFO = parseFuzzSeed(process.env.PEN_FUZZ_SEED);
const SEED = SEED_INFO.numeric;
const OP_COUNT = resolveOpCount();
const FORCE_FAIL_AT = Number(process.env.PEN_FUZZ_FORCE_FAIL_AT);

// Seeds that failed this suite, replayed at smoke scale. Every one failed
// before op 120.
// - Undo of a merge reports a content move, and the old oracle resolved before
//   repairing and expected the raw CRDT position (AN14): 2371651956 (run
//   35052050837), 2692182216 (35814653198), 2471244780 (36374424469),
//   231507691 (36811450488), 2246478689 (34009110614), 2257784941
//   (33716069126).
// - An insert at an assoc 1 anchor whose character was deleted leaves the
//   anchor in front (AN2): 2095813717 (34802988393), the same for a stream
//   flush 270714555 (36291707677), and for the fallback insert of an undo,
//   redo or merge that had nothing to do 66638231 (34433569732), 2865217711
//   (33833404468), 1976218039 (34735633656).
// - A dead anchor that a split revived from its last live position (AN14), and
//   a merge that appends at an assoc 1 anchor on the target's end (AN2), both
//   from local sweeps: 2077975061, 1517311083.
const PINNED_SEEDS = [
	2371651956, 2692182216, 2471244780, 231507691, 2246478689, 2257784941,
	2095813717, 270714555, 66638231, 2865217711, 1976218039, 2077975061,
	1517311083,
] as const;
const PINNED_OP_COUNT = 300;

// The budget has to track the count, or the two run paths disagree about it:
// a number chosen for the 200-op smoke kills the nightly soak, and one chosen
// for the soak stops catching a hang in the smoke. 22ms/op is 3x the 7.3ms/op
// measured at 40_000, which covers the ubuntu-latest factor and still fails
// well before nightly.yml's job timeout. The floor keeps the smoke tolerant of
// a cold worker.
const TIMEOUT_MS = Math.max(20_000, OP_COUNT * 22);

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function parseFuzzSeed(raw: string | undefined): {
	raw: string;
	numeric: number;
} {
	const source = raw && raw.length > 0 ? raw : "20260822";
	const asNumber = Number(source);
	if (Number.isFinite(asNumber)) {
		return { raw: source, numeric: asNumber >>> 0 };
	}
	let hash = 2166136261;
	for (let i = 0; i < source.length; i++) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return { raw: source, numeric: hash >>> 0 };
}

function resolveOpCount(): number {
	const override = Number(process.env.PEN_FUZZ_OP_COUNT);
	if (Number.isFinite(override) && override > 0) {
		return Math.floor(override);
	}
	// This harness is quadratic by construction: snapshotModel walks every
	// block and reads its logical text once per step, and the document grows
	// as the fuzz inserts, splits and streams. Measured on an Apple Silicon
	// laptop: 5_000 ops 2.5s, 10_000 ops 11.2s, 40_000 ops 291s.
	//
	// 1_000_000 was never reachable on that curve and had never run to prove
	// otherwise, because nightly.yml's schedule only fires from the default
	// branch. 40_000 is the largest count with a measured wall clock; at the
	// ~2.4x ubuntu-latest factor the benches see it is ~12 minutes, which
	// fits nightly.yml's 40-minute job alongside the two property suites.
	//
	// The PR `pnpm test` path stays a smoke. 10_000 there was a soak in a
	// unit job: 11.6s idle but ~200s on ubuntu-latest under turbo, past
	// birpc's 60s RPC window, so every assertion passed and vitest still
	// exited 1.
	return NIGHTLY ? 40_000 : 200;
}

class Rng {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	next(): number {
		this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
		return this.state / 0x100000000;
	}

	int(max: number): number {
		if (max <= 0) {
			return 0;
		}
		return Math.floor(this.next() * max);
	}

	pick<T>(items: readonly T[]): T {
		return items[this.int(items.length)]!;
	}
}

type Point = { blockId: string; offset: number };

type ActionKind =
	| "insert"
	| "delete"
	| "split"
	| "merge"
	| "remove"
	| "remote"
	| "undo"
	| "redo"
	| "stream";

interface Tracked {
	anchor: Anchor;
	point: Point | null;
	assoc: Assoc;
	/** Bound to a deleted character at the start of the step (AN2). */
	collapsed: boolean;
}

interface FuzzRun {
	seed: number;
	raw: string;
	opCount: number;
}

interface Model {
	texts: Map<string, string>;
	order: string[];
}

const SOURCES: readonly CommitEventSource[] = [
	"apply",
	"remote",
	"undo",
	"redo",
	"stream",
];

function createEditor(): Editor {
	return createCoreEditor({
		schema: createDefaultSchema(),
		preset: noDefaultExtensionsPreset,
	});
}

function logicalText(editor: Editor, blockId: string): string {
	return editor.getBlock(blockId)?.textContent() ?? "";
}

function snapshotModel(editor: Editor): Model {
	const order = [...editor.documentState.blockOrder];
	const texts = new Map<string, string>();
	for (const id of order) {
		texts.set(id, logicalText(editor, id));
	}
	return { texts, order };
}

function clamp(offset: number, length: number): number {
	if (!Number.isFinite(offset) || offset < 0) {
		return 0;
	}
	return Math.max(0, Math.min(offset, length));
}

function mapInsert(
	point: Point,
	assoc: Assoc,
	blockId: string,
	at: number,
	length: number,
): Point {
	if (point.blockId !== blockId) {
		return point;
	}
	if (point.offset < at) {
		return point;
	}
	if (point.offset === at) {
		return assoc === 1 ? { blockId, offset: point.offset + length } : point;
	}
	return { blockId, offset: point.offset + length };
}

function mapDelete(
	point: Point,
	blockId: string,
	from: number,
	to: number,
): Point {
	if (point.blockId !== blockId) {
		return point;
	}
	if (point.offset <= from) {
		return point;
	}
	if (point.offset >= to) {
		return { blockId, offset: point.offset - (to - from) };
	}
	return { blockId, offset: from };
}

function mapSplit(
	point: Point,
	assoc: Assoc,
	blockId: string,
	offset: number,
	newBlockId: string,
): Point {
	if (point.blockId !== blockId) {
		return point;
	}
	if (point.offset > offset) {
		return { blockId: newBlockId, offset: point.offset - offset };
	}
	if (point.offset === offset && assoc === 1) {
		return { blockId: newBlockId, offset: 0 };
	}
	return point;
}

// The source's text is appended to the target at the join, so a target point
// on the join is an insertion point like any other (AN2).
function mapMerge(
	point: Point,
	assoc: Assoc,
	sourceId: string,
	targetId: string,
	joinOffset: number,
	sourceLength: number,
): Point {
	if (point.blockId !== sourceId) {
		return mapInsert(point, assoc, targetId, joinOffset, sourceLength);
	}
	return { blockId: targetId, offset: joinOffset + point.offset };
}

function mapRemove(point: Point, removedId: string): Point | null {
	if (point.blockId !== removedId) {
		return point;
	}
	return null;
}

// AN14's moved-range rule, stated for the oracle: a point strictly inside the
// range moves, and so does one on the edge it is bound to, or on either edge
// once the commit removed the block the range came from.
function mapMoves(
	editor: Editor,
	point: Point,
	assoc: Assoc,
	moves: readonly ContentMove[],
): Point | null {
	for (const move of moves) {
		if (point.blockId !== move.fromBlockId) {
			continue;
		}
		const { from, to } = move.fromRange;
		const removed = editor.getBlock(move.fromBlockId) === null;
		const inside =
			(point.offset > from && point.offset < to) ||
			(point.offset === from && (assoc === 1 || removed)) ||
			(point.offset === to && to > from && (assoc === -1 || removed));
		if (inside) {
			return {
				blockId: move.toBlockId,
				offset: move.toOffset + point.offset - from,
			};
		}
	}
	return null;
}

// AN2's exception: an assoc 1 anchor whose character was deleted sits in front
// of that tombstone, and Yjs integrates text inserted at the same offset after
// it, so the anchor keeps its place like an assoc -1 anchor would.
function insertAssoc(item: Tracked): Assoc {
	return item.collapsed ? -1 : item.assoc;
}

function yText(
	doc: Editor["internals"]["crdtDoc"],
	blockId: string,
): Y.Text | null {
	if (!isYjsCRDTDocument(doc)) {
		return null;
	}
	const content = doc.penDocument.blocks.get(blockId)?.get("content");
	return content instanceof Y.Text ? content : null;
}

// Whether an assoc 1 anchor's character is deleted, after following `redone`
// the way a local-provenance resolve does (AN13). A position at the end of the
// text carries no character and never collapses.
function boundToDeletedText(editor: Editor, anchor: Anchor): boolean {
	const doc = editor.internals.crdtDoc;
	if (anchor.assoc !== 1 || !isYjsCRDTDocument(doc)) {
		return false;
	}
	let next = Y.decodeRelativePosition(anchor.position).item;
	if (!next) {
		return false;
	}
	let diff = 0;
	let item: Y.Item | null = null;
	while (next) {
		const id = diff > 0 ? Y.createID(next.client, next.clock + diff) : next;
		const found: unknown = Y.getItem(doc.ydoc.store, id);
		if (!(found instanceof Y.Item)) {
			return true;
		}
		diff = id.clock - found.id.clock;
		item = found;
		next = found.redone;
	}
	return item?.deleted ?? true;
}

async function runAnchorFuzz(run: FuzzRun): Promise<void> {
	const rng = new Rng(run.seed);
	const editor = createEditor();
	const adapter = editor.internals.adapter;
	const undo = adapter.createUndoManager(editor.internals.crdtDoc, {
		captureTimeout: 0,
		trackedOriginTypes: ["user"],
	});
	const startId = editor.firstBlock()!.id;
	editor.apply([
		{
			type: "splice-text",
			blockId: startId,
			from: 0,
			to: 0,
			insert: "meadow sage",
		},
	]);
	undo.stopCapturing();
	const remoteDoc = adapter.fork!(editor.internals.crdtDoc);

	const syncRemote = () => {
		adapter.applyUpdate(
			remoteDoc,
			adapter.encodeState(editor.internals.crdtDoc),
		);
	};

	const tracked: Tracked[] = [];
	const mint = (point: Point, assoc: Assoc) => {
		const anchor = editor.anchors.create(point, assoc);
		if (anchor) {
			tracked.push({ anchor, point, assoc, collapsed: false });
		}
	};
	mint({ blockId: startId, offset: 3 }, 1);
	mint({ blockId: startId, offset: 6 }, -1);
	mint({ blockId: startId, offset: 6 }, 1);
	mint({ blockId: startId, offset: 9 }, 1);

	const histogram: Record<ActionKind, number> = {
		insert: 0,
		delete: 0,
		split: 0,
		merge: 0,
		remove: 0,
		remote: 0,
		undo: 0,
		redo: 0,
		stream: 0,
	};
	const sources: Record<CommitEventSource, number> = {
		apply: 0,
		remote: 0,
		undo: 0,
		redo: 0,
		stream: 0,
	};
	editor.on("commit", (event) => {
		sources[event.source] += 1;
	});

	const forced: ActionKind[] = [
		"insert",
		"split",
		"merge",
		"remove",
		"remote",
		"undo",
		"redo",
		"stream",
		"delete",
	];

	let nextBlock = 0;
	const newId = () => {
		nextBlock += 1;
		return `fuzz-${nextBlock}`;
	};

	for (let i = 1; i <= run.opCount; i++) {
		if (i % 100 === 0) {
			// macrotask, not Promise.resolve: birpc acks on timers/IPC
			await new Promise<void>((resolve) => {
				setImmediate(resolve);
			});
		}
		if (Number.isFinite(FORCE_FAIL_AT) && i === FORCE_FAIL_AT) {
			throw new Error(
				`forced fuzz failure at op ${i} seed=${run.seed} raw=${run.raw}`,
			);
		}

		const model = snapshotModel(editor);
		const kind =
			i <= forced.length ? forced[i - 1]! : rng.pick(forced);
		const living = model.order.filter((id) => editor.getBlock(id));
		if (living.length === 0) {
			break;
		}
		const blockId = rng.pick(living);
		const text = model.texts.get(blockId) ?? "";
		for (const item of tracked) {
			const prior = editor.anchors.resolve(item.anchor);
			item.point = prior
				? { blockId: prior.blockId, offset: prior.offset }
				: null;
			item.collapsed = boundToDeletedText(editor, item.anchor);
		}
		let settledByUndo = false;
		// A kind with nothing to act on falls through to the plain insert, so
		// failures name what ran rather than what was drawn.
		let performed: string = kind;

		if (kind === "insert") {
			const at = rng.int(text.length + 1);
			const insert = rng.pick(["x", "ab", " ", "Δ"]);
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: at,
					to: at,
					insert: insert,
				},
			]);
			for (const item of tracked) {
				if (item.point) {
					item.point = mapInsert(
						item.point,
						insertAssoc(item),
						blockId,
						at,
						insert.length,
					);
				}
			}
			histogram.insert += 1;
		} else if (kind === "delete" && text.length > 0) {
			const from = rng.int(text.length);
			const to = Math.min(text.length, from + 1 + rng.int(2));
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: from,
					to: from + to - from,
					insert: "",
				},
			]);
			for (const item of tracked) {
				if (item.point) {
					item.point = mapDelete(
						item.point,
						blockId,
						from,
						to,
					);
				}
			}
			histogram.delete += 1;
		} else if (kind === "split" && text.length > 0) {
			const offset = 1 + rng.int(Math.max(1, text.length - 1));
			const dest = newId();
			applySplitBlock(editor, {
				blockId,
				offset,
				newBlockId: dest,
			});
			const splitMove = (
				editor.lastChangeSummary
					? deriveContentMoves(
							editor.lastChangeSummary,
							undefined,
						)
					: []
			).find((move) => move.fromBlockId === blockId);
			const splitAt = splitMove?.fromRange.from ?? offset;
			for (const item of tracked) {
				if (item.point) {
					item.point = mapSplit(
						item.point,
						item.assoc,
						blockId,
						splitAt,
						splitMove?.toBlockId ?? dest,
					);
				}
			}
			histogram.split += 1;
		} else if (kind === "merge" && living.length >= 2) {
			const index = model.order.indexOf(blockId);
			const sourceId =
				model.order[index + 1] ?? model.order[index - 1];
			if (sourceId && sourceId !== blockId) {
				const targetId =
					index + 1 === model.order.indexOf(sourceId)
						? blockId
						: sourceId;
				const fromId =
					targetId === blockId ? sourceId : blockId;
				applyMergeBlocks(editor, {
					targetBlockId: targetId,
					sourceBlockId: fromId,
				});
				const mergeMove = (
					editor.lastChangeSummary
						? deriveContentMoves(
								editor.lastChangeSummary,
								undefined,
							)
						: []
				).find((move) => move.fromBlockId === fromId);
				const joinOffset = mergeMove?.toOffset ?? 0;
				for (const item of tracked) {
					if (item.point) {
						item.point = mapMerge(
							item.point,
							insertAssoc(item),
							fromId,
							targetId,
							joinOffset,
							(model.texts.get(fromId) ?? "").length,
						);
					}
				}
				histogram.merge += 1;
			}
		} else if (kind === "remove" && living.length >= 2) {
			editor.apply([{ type: "delete-block", blockId }]);
			for (const item of tracked) {
				if (item.point) {
					item.point = mapRemove(item.point, blockId);
				}
			}
			histogram.remove += 1;
		} else if (kind === "remote") {
			syncRemote();
			const remoteText = yText(remoteDoc, blockId);
			if (remoteText) {
				adapter.transact(
					remoteDoc,
					() => {
						remoteText.insert(0, "R");
					},
					"collaborator",
				);
				adapter.applyUpdate(
					editor.internals.crdtDoc,
					adapter.encodeState(remoteDoc),
				);
				for (const item of tracked) {
					if (item.point) {
						item.point = mapInsert(
							item.point,
							insertAssoc(item),
							blockId,
							0,
							1,
						);
					}
				}
				histogram.remote += 1;
			}
		} else if (kind === "undo" && undo.canUndo()) {
			undo.undo();
			settledByUndo = true;
			histogram.undo += 1;
		} else if (kind === "redo" && undo.canRedo()) {
			undo.redo();
			settledByUndo = true;
			histogram.redo += 1;
		} else if (kind === "stream") {
			const writer = editor.openTextStream(
				{ blockId },
				{ origin: { type: "ai", groupId: `fuzz-${i}` } },
			);
			writer.append("s");
			writer.flush();
			writer.close();
			for (const item of tracked) {
				if (item.point) {
					item.point = mapInsert(
						item.point,
						insertAssoc(item),
						blockId,
						text.length,
						1,
					);
				}
			}
			histogram.stream += 1;
		} else {
			performed = `insert (${kind} had nothing to act on)`;
			const at = rng.int(text.length + 1);
			editor.apply([
				{
					type: "splice-text",
					blockId,
					from: at,
					to: at,
					insert: "z",
				},
			]);
			for (const item of tracked) {
				if (item.point) {
					item.point = mapInsert(
						item.point,
						insertAssoc(item),
						blockId,
						at,
						1,
					);
				}
			}
			histogram.insert += 1;
		}

		const summary = editor.lastChangeSummary;
		const moves = summary
			? deriveContentMoves(summary, undefined)
			: [];
		for (const item of tracked) {
			const unrepaired = item.anchor;
			item.anchor = repairAnchor(editor, item.anchor, moves);
			if (settledByUndo) {
				// No text model covers undo and redo, so their oracle is AN14
				// itself: a pre-commit point inside a reported content move
				// lands where that text landed, and any other point sits where
				// the CRDT put it. Repair runs first so the raw resolve below
				// cannot stand in for the pre-commit target.
				const raw = editor.anchors.resolve(unrepaired);
				item.point =
					(item.point &&
						mapMoves(editor, item.point, item.assoc, moves)) ??
					(raw ? { blockId: raw.blockId, offset: raw.offset } : null);
			}
			const resolved = editor.anchors.resolve(item.anchor);
			if (!item.point) {
				expect(
					resolved,
					`AN1 death seed=${run.seed} op=${i} kind=${performed}`,
				).toBeNull();
				continue;
			}
			expect(
				resolved,
				`AN1 seed=${run.seed} op=${i} kind=${performed}`,
			).toEqual({
				blockId: item.point.blockId,
				offset: clamp(
					item.point.offset,
					logicalText(editor, item.point.blockId).length,
				),
			});
		}

		if (i % 1000 === 0) {
			for (const item of tracked) {
				const again = editor.anchors.deserialize(
					editor.anchors.serialize(item.anchor),
				);
				expect(
					again,
					`AN6 seed=${run.seed} op=${i}`,
				).not.toBeNull();
				expect(
					editor.anchors.resolve(again!),
					`AN6 seed=${run.seed} op=${i}`,
				).toEqual(editor.anchors.resolve(item.anchor));
			}
		}
	}

	expect(
		histogram.split,
		`split histogram seed=${run.seed}`,
	).toBeGreaterThan(0);
	expect(
		histogram.merge,
		`merge histogram seed=${run.seed}`,
	).toBeGreaterThan(0);
	expect(
		histogram.remove,
		`remove histogram seed=${run.seed}`,
	).toBeGreaterThan(0);
	for (const source of SOURCES) {
		expect(
			sources[source],
			`source ${source} seed=${run.seed}`,
		).toBeGreaterThan(0);
	}

	editor.destroy();
}

describe("an-fuzz AN1–AN5 AN14", () => {
	it(
		"AN1-AN5: repaired anchors match the v2 cross-block oracle after every generated step",
		{ timeout: TIMEOUT_MS },
		async () => {
			await runAnchorFuzz({
				seed: SEED,
				raw: SEED_INFO.raw,
				opCount: OP_COUNT,
			});
		},
	);

	it.each(PINNED_SEEDS)(
		"AN1-AN5 AN14: pinned seed %i replays clean at smoke scale",
		async (seed) => {
			await runAnchorFuzz({
				seed,
				raw: `pinned-${seed}`,
				opCount: PINNED_OP_COUNT,
			});
		},
	);

	it("AN10: cell-text anchors survive generated in-cell insert and delete", () => {
		const editor = createEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "0123456789",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 1, col: 1 },
				from: 0,
				to: 0,
				insert: "cell two",
			},
		]);
		const north = editor.anchors.create(
			{ blockId: "t1", offset: 5, cell: { row: 0, col: 0 } },
			1,
		);
		const south = editor.anchors.create(
			{ blockId: "t1", offset: 4, cell: { row: 1, col: 1 } },
			1,
		);
		expect(north, "AN10 cell north mint").not.toBeNull();
		expect(south, "AN10 cell south mint").not.toBeNull();

		const cellSteps = Math.min(50, OP_COUNT);
		for (let i = 1; i <= cellSteps; i++) {
			editor.apply([
				{
					type: "splice-text",
					blockId: "t1",
					cell: { row: 0, col: 0 },
					from: 0,
					to: 0,
					insert: "x",
				},
			]);
			expect(
				editor.anchors.resolve(north!),
				`AN10 cell north prefix-insert op=${i}`,
			).toEqual({
				blockId: "t1",
				offset: 5 + i,
				cell: { row: 0, col: 0 },
			});
			expect(
				editor.anchors.resolve(south!),
				`AN10 cell south stays put op=${i}`,
			).toEqual({
				blockId: "t1",
				offset: 4,
				cell: { row: 1, col: 1 },
			});
		}

		const northAfterInserts = 5 + cellSteps;
		editor.apply([
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: northAfterInserts - 2,
				to: northAfterInserts - 2 + 5,
				insert: "",
			},
		]);
		expect(
			editor.anchors.resolve(north!),
			"AN10 cell north delete-collapse",
		).toEqual({
			blockId: "t1",
			offset: northAfterInserts - 2,
			cell: { row: 0, col: 0 },
		});
		expect(
			editor.anchors.resolve(south!),
			"AN10 cell south after north delete",
		).toEqual({
			blockId: "t1",
			offset: 4,
			cell: { row: 1, col: 1 },
		});
		editor.destroy();
	});
});
