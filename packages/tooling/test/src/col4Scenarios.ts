import { applySplitBlock } from "@input/pen-core";
import type {
	DiagnosticEvent,
	DocumentOp,
	Editor,
	Position,
} from "@input/pen-types";
import {
	createPeerHarness,
	describePeerSchedule,
	PEER_SCHEDULES,
	runPeerSchedules,
} from "./peerHarness";
import { mulberry32 } from "./seededRandom";
import { assertStructuralInvariants } from "./structuralInvariants";
import {
	collectInlineText,
	countEmptyInlineBlocks,
	countMemberships,
	getParentId,
	hasParentCycle,
	listBlockIds,
	parentsOf,
	visibleText,
} from "./twoPeerInspect";
import type {
	Peer,
	PeerHarness,
	PeerHarnessOptions,
	PeerSchedule,
	TestBlock,
} from "./types";

/** One COL4 matrix row, run at every size under every default schedule. */
export type Col4PeerScenario = {
	name: string;
	/** Peer counts the row runs at. Default {@link COL4_PEER_SIZES}. */
	sizes?: readonly number[];
	options: (n: number) => PeerHarnessOptions;
	/** Peer `i` performs the row's i-th action. */
	apply: (harness: PeerHarness) => void;
	/** The row's named outcome, checked on every peer after quiesce. */
	invariant: (harness: PeerHarness, schedule: PeerSchedule) => void;
};

/** COL4: every row runs at two, three, and five peers. */
export const COL4_PEER_SIZES = [2, 3, 5] as const;

/** `PEER_SCHEDULES` plus two seeded schedules: what every COL4 row runs under. */
export const COL4_DEFAULT_SCHEDULES: readonly PeerSchedule[] = [
	...PEER_SCHEDULES,
	{ seed: 1 },
	{ seed: 2 },
];

const SPLIT_TEXT = "HelloWorld";
const SPLIT_OFFSET = 5;

/** Diagnostics every peer emitted, per harness (the cycle row reads them). */
const harnessDiagnostics = new WeakMap<PeerHarness, DiagnosticEvent[]>();

function collectDiagnostics(harness: PeerHarness): void {
	const events: DiagnosticEvent[] = [];
	for (const peer of harness.peers) {
		peer.editor.on("diagnostic", (event) => {
			events.push(event);
		});
	}
	harnessDiagnostics.set(harness, events);
}

function fail(row: string, peer: Peer, detail: string): never {
	throw new Error(`COL4 ${row} (peer ${peer.label}): ${detail}`);
}

function textOf(peer: Peer, blockId: string): string | null {
	return listBlockIds(peer.editor).includes(blockId)
		? visibleText(peer.editor, blockId)
		: null;
}

function orderIds(peer: Peer): string[] {
	const order = peer.editor.document.blockOrder;
	const ids: string[] = [];
	for (let i = 0; i < order.length; i++) {
		ids.push(order.get(i));
	}
	return ids;
}

function entriesNaming(peer: Peer, blockId: string): number {
	let count = orderIds(peer).filter((id) => id === blockId).length;
	for (const [, candidate] of peer.editor.document.blocks.entries()) {
		const children = (candidate as { get?(key: string): unknown }).get?.(
			"children",
		) as { length: number; get(index: number): unknown } | undefined;
		if (!children || typeof children.get !== "function") continue;
		for (let i = 0; i < children.length; i++) {
			if (children.get(i) === blockId) count += 1;
		}
	}
	return count;
}

function paragraphs(count: number, prefix = "p"): TestBlock[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `${prefix}${index + 1}`,
		type: "paragraph",
		content: `${prefix.toUpperCase()}${index + 1}`,
	}));
}

/** Tail copies at n peers: `["Hello", "World" × n]` (AN14 copy semantics). */
export function expectedSplitSameOffsetTexts(n: number): string[] {
	return [
		SPLIT_TEXT.slice(0, SPLIT_OFFSET),
		...Array.from({ length: n }, () => SPLIT_TEXT.slice(SPLIT_OFFSET)),
	];
}

export const col4SplitSameOffset: Col4PeerScenario = {
	name: "split-same-offset",
	options: () => ({
		blocks: [{ id: "p1", type: "paragraph", content: SPLIT_TEXT }],
	}),
	apply(harness) {
		for (const peer of harness.peers) {
			applySplitBlock(peer.editor, {
				blockId: "p1",
				offset: SPLIT_OFFSET,
				newBlockId: `split-${peer.index}`,
			});
		}
	},
	invariant(harness) {
		const expected = expectedSplitSameOffsetTexts(harness.size);
		for (const peer of harness.peers) {
			if (textOf(peer, "p1") !== "Hello") {
				fail("split-same-offset", peer, `p1 is "${textOf(peer, "p1")}"`);
			}
			for (const splitter of harness.peers) {
				const text = textOf(peer, `split-${splitter.index}`);
				if (text !== "World") {
					fail(
						"split-same-offset",
						peer,
						`split-${splitter.index} should hold its own tail copy "World", got ${JSON.stringify(text)}`,
					);
				}
			}
			const texts = collectInlineText(peer.editor);
			if (JSON.stringify(texts) !== JSON.stringify(expected)) {
				fail(
					"split-same-offset",
					peer,
					`expected ${JSON.stringify(expected)}, got ${JSON.stringify(texts)}`,
				);
			}
			if (countEmptyInlineBlocks(peer.editor) > 0) {
				fail("split-same-offset", peer, "an empty block remained");
			}
		}
	},
};

export const col4SplitDifferentOffsets: Col4PeerScenario = {
	name: "split-different-offsets",
	options: () => ({
		blocks: [{ id: "p1", type: "paragraph", content: SPLIT_TEXT }],
	}),
	apply(harness) {
		for (const peer of harness.peers) {
			applySplitBlock(peer.editor, {
				blockId: "p1",
				offset: 1 + peer.index,
				newBlockId: `split-${peer.index}`,
			});
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			if (textOf(peer, "p1") !== SPLIT_TEXT.slice(0, 1)) {
				fail(
					"split-different-offsets",
					peer,
					`p1 is ${JSON.stringify(textOf(peer, "p1"))}`,
				);
			}
			for (const splitter of harness.peers) {
				const expected = SPLIT_TEXT.slice(1 + splitter.index);
				const text = textOf(peer, `split-${splitter.index}`);
				if (text !== expected) {
					fail(
						"split-different-offsets",
						peer,
						`split-${splitter.index} should be "${expected}", got ${JSON.stringify(text)}`,
					);
				}
			}
			const all = collectInlineText(peer.editor).join("");
			for (const letter of SPLIT_TEXT) {
				if (!all.includes(letter)) {
					fail("split-different-offsets", peer, `missing "${letter}"`);
				}
			}
		}
	},
};

export const col4DeleteVsTyping: Col4PeerScenario = {
	name: "delete-vs-typing",
	options: () => ({
		blocks: [
			{ id: "p1", type: "paragraph", content: "Keep" },
			{ id: "p2", type: "paragraph", content: "Other" },
		],
	}),
	apply(harness) {
		for (const peer of harness.peers) {
			if (peer.index === 0) {
				peer.editor.apply([{ type: "delete-block", blockId: "p1" }]);
				continue;
			}
			peer.editor.apply([
				{
					type: "splice-text",
					blockId: "p1",
					from: 4,
					to: 4,
					insert: ` lost${peer.index}`,
				},
			]);
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			if (listBlockIds(peer.editor).includes("p1")) {
				fail("delete-vs-typing", peer, "p1 survived its deletion");
			}
			if (collectInlineText(peer.editor).join("").includes("lost")) {
				fail("delete-vs-typing", peer, "typed text survived the deletion");
			}
		}
	},
};

const DELETE_VS_MOVE_POSITIONS: readonly Position[] = [
	"first",
	"last",
	{ after: "p3" },
	{ before: "p1" },
];

export const col4DeleteVsMove: Col4PeerScenario = {
	name: "delete-vs-move",
	options: () => ({ blocks: paragraphs(4) }),
	apply(harness) {
		for (const peer of harness.peers) {
			if (peer.index === 0) {
				peer.editor.apply([{ type: "delete-block", blockId: "p2" }]);
				continue;
			}
			peer.editor.apply([
				{
					type: "move-block",
					blockId: "p2",
					position:
						DELETE_VS_MOVE_POSITIONS[
							(peer.index - 1) % DELETE_VS_MOVE_POSITIONS.length
						]!,
				},
			]);
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			if (peer.editor.document.blocks.get("p2") !== undefined) {
				fail("delete-vs-move", peer, "p2 survived its deletion");
			}
			const entries = entriesNaming(peer, "p2");
			if (entries !== 0) {
				fail(
					"delete-vs-move",
					peer,
					`${entries} structural entries still name p2 (Rule 12)`,
				);
			}
			if (JSON.stringify(orderIds(peer)) !== JSON.stringify(["p1", "p3", "p4"])) {
				fail("delete-vs-move", peer, `order is ${JSON.stringify(orderIds(peer))}`);
			}
		}
	},
};

export const col4MoveToDifferentParents: Col4PeerScenario = {
	name: "move-to-different-parents",
	options: (n) => ({
		blocks: [
			...Array.from({ length: n }, (_, index) => ({
				id: `parent-${index}`,
				type: "callout",
				content: `Parent ${index}`,
				children: [],
			})),
			{ id: "mover", type: "paragraph", content: "Move me" },
		],
	}),
	apply(harness) {
		for (const peer of harness.peers) {
			peer.editor.apply([
				{
					type: "move-block",
					blockId: "mover",
					position: { parent: `parent-${peer.index}`, index: 0 },
				},
			]);
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			const memberships = countMemberships(peer.editor, "mover");
			if (memberships !== 1) {
				fail("move-to-different-parents", peer, `mover has ${memberships} memberships`);
			}
			const parents = parentsOf(peer.editor, "mover");
			if (parents.length !== 1 || !parents[0]!.startsWith("parent-")) {
				fail(
					"move-to-different-parents",
					peer,
					`mover should have one parent, found [${parents.join(", ")}]`,
				);
			}
			const copies = collectInlineText(peer.editor).filter(
				(text) => text === "Move me",
			).length;
			if (copies !== 1) {
				fail("move-to-different-parents", peer, `mover text present ${copies} times`);
			}
		}
	},
};

export const col4ParentCycle: Col4PeerScenario = {
	name: "parent-cycle",
	options: (n) => ({
		blocks: Array.from({ length: n }, (_, index) => ({
			id: `b-${index}`,
			type: "callout",
			content: `B${index}`,
			children: [],
		})),
	}),
	apply(harness) {
		collectDiagnostics(harness);
		for (const peer of harness.peers) {
			peer.editor.apply([
				{
					type: "move-block",
					blockId: `b-${peer.index}`,
					position: { parent: `b-${(peer.index + 1) % harness.size}`, index: 0 },
				},
			]);
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			if (hasParentCycle(peer.editor)) {
				fail("parent-cycle", peer, "a parent cycle survived");
			}
		}
		const cycleDiagnostics = (harnessDiagnostics.get(harness) ?? []).filter(
			(event) => event.code === "parent-cycle",
		);
		if (cycleDiagnostics.length === 0) {
			throw new Error("COL4 parent-cycle: no peer emitted a parent-cycle diagnostic");
		}
	},
};

export const col4IndentOutdent: Col4PeerScenario = {
	name: "indent-outdent",
	options: (n) => ({
		blocks: [
			...Array.from({ length: n }, (_, index) => ({
				id: `l-${index}`,
				type: "bulletListItem",
				content: `Item ${index}`,
			})),
			{ id: "l-last", type: "bulletListItem", content: "Last" },
		],
	}),
	apply(harness) {
		for (const peer of harness.peers) {
			peer.editor.apply([
				{
					type: "set-props",
					blockId: "l-last",
					props:
						peer.index % 2 === 0
							? { indent: 1, parentId: `l-${peer.index}` }
							: { indent: 0, parentId: null },
				},
			]);
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			if (parentsOf(peer.editor, "l-last").length > 1) {
				fail("indent-outdent", peer, "l-last has more than one parent");
			}
			if (countMemberships(peer.editor, "l-last") !== 1) {
				fail("indent-outdent", peer, "l-last does not have exactly one membership");
			}
		}
	},
};

export const col4OverlappingReorder: Col4PeerScenario = {
	name: "overlapping-reorder",
	options: () => ({ blocks: paragraphs(6) }),
	apply(harness) {
		for (const peer of harness.peers) {
			peer.editor.apply([
				{
					type: "move-block",
					blockId: "p3",
					position: peer.index === 0 ? "first" : { after: `p${peer.index}` },
				},
			]);
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			const ids = orderIds(peer);
			if (ids.length !== 6 || new Set(ids).size !== 6) {
				fail("overlapping-reorder", peer, `order is ${JSON.stringify(ids)}`);
			}
		}
	},
};

export const col4DeleteParentWhileChildEdited: Col4PeerScenario = {
	name: "delete-parent-while-child-edited",
	options: () => ({
		blocks: [
			{ id: "parent", type: "toggle", content: "Parent" },
			{
				id: "child",
				type: "paragraph",
				content: "Child",
				props: { parentId: "parent" },
			},
		],
	}),
	apply(harness) {
		for (const peer of harness.peers) {
			if (peer.index === 0) {
				peer.editor.apply([{ type: "delete-block", blockId: "parent" }]);
				continue;
			}
			peer.editor.apply([
				{
					type: "splice-text",
					blockId: "child",
					from: 5,
					to: 5,
					insert: ` e${peer.index}`,
				},
			]);
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			const ids = listBlockIds(peer.editor);
			if (ids.includes("parent")) {
				fail("delete-parent-while-child-edited", peer, "parent survived");
			}
			if (!ids.includes("child")) {
				fail("delete-parent-while-child-edited", peer, "child was lost");
			}
			const text = visibleText(peer.editor, "child");
			for (const editor of harness.peers.slice(1)) {
				if (!text.includes(` e${editor.index}`)) {
					fail(
						"delete-parent-while-child-edited",
						peer,
						`child edit from ${editor.label} missing in "${text}"`,
					);
				}
			}
			if (getParentId(peer.editor, "child") !== null) {
				fail("delete-parent-while-child-edited", peer, "dangling parentId kept");
			}
		}
	},
};

export const col4ListReparent: Col4PeerScenario = {
	name: "list-reparent",
	options: (n) => ({
		blocks: [
			...Array.from({ length: n }, (_, index) => ({
				id: `l-${index}`,
				type: "bulletListItem",
				content: `Item ${index}`,
			})),
			{ id: "target", type: "bulletListItem", content: "Target" },
		],
	}),
	apply(harness) {
		for (const peer of harness.peers) {
			peer.editor.apply([
				{
					type: "set-props",
					blockId: "target",
					props: { parentId: `l-${peer.index}` },
				},
			]);
		}
	},
	invariant(harness) {
		for (const peer of harness.peers) {
			const parentId = getParentId(peer.editor, "target");
			if (!parentId || !parentId.startsWith("l-")) {
				fail("list-reparent", peer, `expected one list parent, found ${parentId}`);
			}
			if (hasParentCycle(peer.editor)) {
				fail("list-reparent", peer, "parent cycle created");
			}
		}
	},
};

const TABLE_BASE_ROWS = 6;
const TABLE_BASE_COLUMNS = 6;

export const col4TableRowColumn: Col4PeerScenario = {
	name: "table-row-column",
	options: () => ({
		blocks: [],
		prepare(editor) {
			editor.apply([
				{
					type: "insert-block",
					blockId: "t1",
					blockType: "table",
					props: {},
					position: "last",
				},
			]);
			const table = editor.getBlock("t1").as("table")!;
			const ops: DocumentOp[] = [];
			for (let row = table.tableRowCount(); row < TABLE_BASE_ROWS; row++) {
				ops.push({ type: "grid", blockId: "t1", change: { kind: "insert-row", index: row } });
			}
			for (
				let column = table.tableColumnCount();
				column < TABLE_BASE_COLUMNS;
				column++
			) {
				ops.push({
					type: "grid",
					blockId: "t1",
					change: { kind: "insert-column", index: column },
				});
			}
			editor.apply(ops);
		},
	}),
	apply(harness) {
		for (const peer of harness.peers) {
			peer.editor.apply([
				{
					type: "grid",
					blockId: "t1",
					change: {
						kind: peer.index % 2 === 0 ? "insert-row" : "insert-column",
						index: 1 + peer.index,
					},
				},
			]);
		}
	},
	invariant(harness) {
		const rowInserts = harness.peers.filter((peer) => peer.index % 2 === 0).length;
		const columnInserts = harness.size - rowInserts;
		for (const peer of harness.peers) {
			const table = peer.editor.getBlock("t1").as("table");
			const rows = table?.tableRowCount() ?? 0;
			const columns = table?.tableColumnCount() ?? 0;
			if (rows !== TABLE_BASE_ROWS + rowInserts) {
				fail("table-row-column", peer, `expected ${TABLE_BASE_ROWS + rowInserts} rows, got ${rows}`);
			}
			if (columns !== TABLE_BASE_COLUMNS + columnInserts) {
				fail(
					"table-row-column",
					peer,
					`expected ${TABLE_BASE_COLUMNS + columnInserts} columns, got ${columns}`,
				);
			}
		}
	},
};

/** The COL4 matrix, one row per named outcome. */
export const COL4_PEER_SCENARIOS: readonly Col4PeerScenario[] = [
	col4SplitSameOffset,
	col4SplitDifferentOffsets,
	col4DeleteVsTyping,
	col4DeleteVsMove,
	col4MoveToDifferentParents,
	col4ParentCycle,
	col4IndentOutdent,
	col4OverlappingReorder,
	col4DeleteParentWhileChildEdited,
	col4ListReparent,
	col4TableRowColumn,
];

/** One row at one size under one schedule: quiesce, converge, oracle, outcome. */
export function runCol4PeerScenarioCase(
	scenario: Col4PeerScenario,
	n: number,
	schedule: PeerSchedule,
): void {
	runPeerSchedules(
		n,
		scenario.options(n),
		scenario.apply,
		scenario.invariant,
		[schedule],
	);
}

/** Runs a row at each of its sizes under every default schedule. */
export function runCol4PeerScenario(scenario: Col4PeerScenario): void {
	for (const n of scenario.sizes ?? COL4_PEER_SIZES) {
		runPeerSchedules(
			n,
			scenario.options(n),
			scenario.apply,
			scenario.invariant,
			COL4_DEFAULT_SCHEDULES,
		);
	}
}

// ── Seeded structural fuzz ───────────────────────────────

type FuzzSplit = {
	kind: "split";
	blockId: string;
	offset: number;
	newBlockId: string;
};

/** One random structural or text op; splits go through `applySplitBlock`. */
export type Col4FuzzOp = DocumentOp | FuzzSplit;

/** The kinds the fuzz catalog emits, for histogram guards. */
export type Col4FuzzOpKind =
	| "splice-text"
	| "split"
	| "set-parent"
	| "set-indent"
	| "move-block"
	| "nested-parent"
	| "insert-block"
	| "delete-block"
	| "grid";

/** Structural kinds: everything but `splice-text`. */
export const COL4_FUZZ_STRUCTURAL_KINDS: readonly Col4FuzzOpKind[] = [
	"split",
	"set-parent",
	"set-indent",
	"move-block",
	"nested-parent",
	"insert-block",
	"delete-block",
	"grid",
];

/** Seed document the fuzz forks from. */
export function col4FuzzSeedOptions(): PeerHarnessOptions {
	return {
		blocks: [
			{ id: "p1", type: "paragraph", content: "Hello World" },
			{ id: "p2", type: "paragraph", content: "Second" },
			{ id: "l1", type: "bulletListItem", content: "one" },
			{ id: "l2", type: "bulletListItem", content: "two" },
			{ id: "c1", type: "callout", content: "Box", children: [] },
			{ id: "c2", type: "callout", content: "Box two", children: [] },
		],
		prepare(editor) {
			editor.apply([
				{
					type: "insert-block",
					blockId: "t1",
					blockType: "table",
					props: {},
					position: "last",
				},
			]);
		},
	};
}

/** Picks one op from the widened catalog (text, split, parent, indent, move, nested-parent, insert, delete, grid). */
export function pickCol4FuzzOp(
	tag: string,
	random: () => number,
): { kind: Col4FuzzOpKind; op: Col4FuzzOp } {
	const catalog: Array<() => { kind: Col4FuzzOpKind; op: Col4FuzzOp }> = [
		() => ({
			kind: "splice-text",
			op: { type: "splice-text", blockId: "p1", from: 5, to: 5, insert: tag },
		}),
		() => ({
			kind: "splice-text",
			op: { type: "splice-text", blockId: "p2", from: 0, to: 0, insert: tag },
		}),
		() => ({
			kind: "split",
			op: {
				kind: "split",
				blockId: "p1",
				offset: 1 + Math.floor(random() * 8),
				newBlockId: `split-${tag}`,
			},
		}),
		() => ({
			kind: "set-parent",
			op: {
				type: "set-props",
				blockId: "l2",
				props: { parentId: random() < 0.5 ? "l1" : null },
			},
		}),
		() => ({
			kind: "set-indent",
			op: {
				type: "set-props",
				blockId: "l2",
				props: { indent: Math.floor(random() * 3) },
			},
		}),
		() => ({
			kind: "move-block",
			op: {
				type: "move-block",
				blockId: "p2",
				position: random() < 0.5 ? { after: "p1" } : { before: "p1" },
			},
		}),
		() => ({
			kind: "move-block",
			op: {
				type: "move-block",
				blockId: "l1",
				position: random() < 0.5 ? "first" : "last",
			},
		}),
		() => ({
			kind: "nested-parent",
			op: {
				type: "move-block",
				blockId: random() < 0.5 ? "p2" : "c2",
				position: { parent: random() < 0.5 ? "c1" : "c2", index: 0 },
			},
		}),
		() => ({
			kind: "insert-block",
			op: {
				type: "insert-block",
				blockId: `n-${tag}`,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		}),
		() => ({ kind: "delete-block", op: { type: "delete-block", blockId: "p2" } }),
		() => ({
			kind: "grid",
			op: { type: "grid", blockId: "t1", change: { kind: "insert-row", index: 2 } },
		}),
		() => ({
			kind: "grid",
			op: { type: "grid", blockId: "t1", change: { kind: "insert-column", index: 2 } },
		}),
	];
	return catalog[Math.floor(random() * catalog.length)]!();
}

function isFuzzSplit(op: Col4FuzzOp): op is FuzzSplit {
	return "kind" in op && op.kind === "split";
}

/** Applies one fuzz op to an editor. */
export function applyCol4FuzzOp(editor: Editor, op: Col4FuzzOp): void {
	if (isFuzzSplit(op)) {
		applySplitBlock(editor, {
			blockId: op.blockId,
			offset: op.offset,
			newBlockId: op.newBlockId,
		});
		return;
	}
	editor.apply([op]);
}

/**
 * Seeded COL4 fuzz: per case, one op per peer, one seeded schedule, quiesce,
 * then convergence and the structural oracle. Deterministic for a seed (CH9).
 * Returns the op-kind histogram.
 */
export function runCol4PeerFuzz(options: {
	peers: number;
	iterations: number;
	seed: number;
}): Map<Col4FuzzOpKind, number> {
	const histogram = new Map<Col4FuzzOpKind, number>();
	for (let iteration = 0; iteration < options.iterations; iteration++) {
		const caseSeed = options.seed + iteration;
		const random = mulberry32(caseSeed);
		const picks = Array.from({ length: options.peers }, (_, index) =>
			pickCol4FuzzOp(`${String.fromCharCode(97 + index)}${iteration}`, random),
		);
		const schedule: PeerSchedule = { seed: caseSeed };
		const harness = createPeerHarness(options.peers, col4FuzzSeedOptions());
		try {
			picks.forEach((pick, index) => {
				histogram.set(pick.kind, (histogram.get(pick.kind) ?? 0) + 1);
				applyCol4FuzzOp(harness.peer(index).editor, pick.op);
			});
			harness.run(schedule);
			harness.quiesce();
			harness.assertConverged();
			assertStructuralInvariants(harness.peer(0));
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(
				`COL4 fuzz failed at seed ${options.seed}, iteration ${iteration} (${options.peers} peers, schedule ${describePeerSchedule(schedule)}), ops ${JSON.stringify(picks.map((pick) => pick.op))}\n${reason}`,
				{ cause: error },
			);
		} finally {
			harness.destroy();
		}
	}
	return histogram;
}
