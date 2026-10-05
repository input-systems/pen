import {
	aiExtension,
	getAIController,
	readAllSuggestions,
} from "@input/pen-ai";
import { deltaStreamExtension } from "@input/pen-ai/stream";
import {
	applyMergeBlocks,
	applySplitBlock,
	summaryTouchedBlockIds,
	undoManagerFacet,
} from "@input/pen-core";
import {
	findDocumentMatches,
	getSearchController,
	searchExtension,
} from "@input/pen-search";
import {
	createModelDouble,
	createPeerHarness,
	generateMixedBlockSpecs,
	type PeerHarness,
	type TestBlock,
	type TestEditor,
} from "@input/pen-test";
import type {
	ChangeSummary,
	CommitEvent,
	DocumentOp,
	Editor,
	PenDocument,
	TextStreamWriter,
	UndoManager,
	Unsubscribe,
} from "@input/pen-types";
import { toolsExtension } from "@input/pen-tools";
import { undoExtension } from "@input/pen-undo";
import { isDeepStrictEqual } from "node:util";
import * as Y from "yjs";
import type { AuditBlockNotifier, AuditInternals } from "./internals";

/**
 * Seeded randomized equivalence for the kept caches A–G (simplification plan
 * Phase 2): after every random operation, each incremental cache must equal
 * the naive full recompute it replaces, on every peer. Each of the
 * `PEER_COUNT` peers carries the realistic stack and a block notifier
 * subscribed like a renderer without virtualization, and writes, undoes and
 * streams; the walk interleaves multi-op transactions, text streams,
 * concurrent moves and first-child inserts with whole, merged and
 * out-of-order deliveries. Each peer also carries a second notifier whose
 * subscriptions churn (`createChurnMount`).
 */

/** Forked peers; three or more let an update land before the one it depends on. */
const PEER_COUNT = 4;

/** Root blocks of the mixed fixture; a multiple of 20, so it holds every slot kind once twice. */
const ROOT_COUNT = 40;
/** Matches the lexicon's "fox" and what the keystrokes type. */
const SEARCH_QUERY = "ox";
const TYPED = ["o", "x", "ox", " ", "fox"] as const;
const LIST_TYPES = [
	"bulletListItem",
	"numberedListItem",
	"checkListItem",
] as const;
const TEXT_TYPES = ["paragraph", "heading", ...LIST_TYPES] as const;
const MAX_INDENT = 3;
const CALLOUTS = ["callout-a", "callout-b"] as const;

export const PROPERTY_OPS = [
	"keystroke",
	"delete-text",
	"split",
	"merge",
	"insert-root",
	"insert-children",
	"insert-parent-id",
	"move-root",
	"move-children",
	"move-parent-id",
	"reorder-parent-id",
	"unparent",
	"delete-block",
	"indent",
	"type-change",
	"format",
	"multi-op",
	"undo",
	"redo",
	"stream-open",
	"stream-append",
	"stream-close",
	"deliver",
	"deliver-merged",
	"deliver-out-of-order",
	"sync-all",
	"race-move-root",
	"race-move-containers",
	"race-first-child",
	"ai-suggest",
	"resolve-suggestion",
	"select",
	"concurrent-delete-move",
] as const;

export type PropertyOp = (typeof PROPERTY_OPS)[number];

function calloutBlocks(): TestBlock[] {
	return CALLOUTS.map((id, index) => ({
		id,
		type: "callout",
		content: `Box ${index} fox`,
		children: [
			{
				id: `${id}-1`,
				type: "bulletListItem",
				props: { indent: 0 },
				content: "one fox",
			},
			{
				id: `${id}-2`,
				type: "numberedListItem",
				props: { indent: 0 },
				content: "two",
			},
			{
				id: `${id}-3`,
				type: "numberedListItem",
				props: { indent: 1 },
				content: "three ox",
			},
		],
	}));
}

interface Rng {
	next(): number;
	int(max: number): number;
	pick<T>(items: readonly T[]): T;
	chance(probability: number): boolean;
}

/** mulberry32: deterministic floats in [0, 1). */
function createRng(seed: number): Rng {
	let state = seed >>> 0;
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (max: number) => (max <= 0 ? 0 : Math.floor(next() * max));
	return {
		next,
		int,
		pick: (items) => items[int(items.length)]!,
		chance: (probability) => next() < probability,
	};
}

type BlockMapLike = {
	get(key: string): unknown;
	toJSON(): Record<string, unknown>;
};

function blocksOf(editor: Editor): Map<string, BlockMapLike> {
	const doc = editor.internals.doc as PenDocument;
	return new Map(
		(
			doc.blocks as unknown as {
				entries(): Iterable<[string, BlockMapLike]>;
			}
		).entries(),
	);
}

/**
 * Every rendered block's type, props and text (marks included), keyed by id.
 * Rendered means in the preorder: a stored block no array reaches (a COL4
 * orphan) is not shown until a local pass re-homes it, and the re-homing
 * commit is the one that must name it.
 */
export function storedBlockStates(editor: Editor): Map<string, string> {
	const states = new Map<string, string>();
	const blocks = blocksOf(editor);
	for (const id of editor.documentState.preorderBlockIds()) {
		const block = blocks.get(id);
		if (!block) continue;
		const content = block.get("content") as
			{ toDelta?(): unknown } | undefined;
		const props = block.get("props") as { toJSON?(): unknown } | undefined;
		states.set(
			id,
			JSON.stringify({
				type: block.get("type"),
				props: props?.toJSON?.() ?? null,
				text: mergeRuns(content?.toDelta?.()),
			}),
		);
	}
	return states;
}

type DeltaRun = { insert?: unknown; attributes?: Record<string, unknown> };

/**
 * A text delta with adjacent string runs of equal attributes joined. A
 * formatting marker a peer left around text another peer deleted splits a
 * run in `toDelta()` without changing the text or its marks, and no commit
 * names that.
 */
function mergeRuns(delta: unknown): unknown {
	if (!Array.isArray(delta)) return null;
	const runs: DeltaRun[] = [];
	for (const run of delta as DeltaRun[]) {
		const previous = runs[runs.length - 1];
		if (
			previous &&
			typeof previous.insert === "string" &&
			typeof run.insert === "string" &&
			isDeepStrictEqual(previous.attributes ?? {}, run.attributes ?? {})
		) {
			runs[runs.length - 1] = { ...previous, insert: previous.insert + run.insert };
			continue;
		}
		runs.push(run);
	}
	return runs;
}

function sortedEntries<K, V>(map: ReadonlyMap<K, V>): [string, V][] {
	return [...map]
		.map(([key, value]): [string, V] => [String(key), value])
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

function normalizeForCompare(value: unknown): unknown {
	if (value instanceof Map)
		return sortedEntries(value).map(([key, entry]) => [
			key,
			normalizeForCompare(entry),
		]);
	if (value instanceof Set) return [...value].map(String).sort();
	if (Array.isArray(value)) return value.map(normalizeForCompare);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				normalizeForCompare(entry),
			]),
		);
	}
	return value;
}

/** The first path at which two normalized values differ, with both sides there. */
function divergence(left: unknown, right: unknown, path: string): string {
	if (Array.isArray(left) && Array.isArray(right)) {
		for (
			let index = 0;
			index < Math.max(left.length, right.length);
			index += 1
		) {
			if (!isDeepStrictEqual(left[index], right[index]))
				return divergence(
					left[index],
					right[index],
					`${path}[${index}]`,
				);
		}
	}
	if (
		left &&
		right &&
		typeof left === "object" &&
		typeof right === "object" &&
		!Array.isArray(left) &&
		!Array.isArray(right)
	) {
		const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
		for (const key of keys) {
			const a = (left as Record<string, unknown>)[key];
			const b = (right as Record<string, unknown>)[key];
			if (!isDeepStrictEqual(a, b))
				return divergence(a, b, `${path}.${key}`);
		}
	}
	const show = (value: unknown) => {
		const text = JSON.stringify(value) ?? "undefined";
		return text.length > 400 ? `${text.slice(0, 400)}…` : text;
	};
	return `at ${path}\n  incremental: ${show(left)}\n  naive:       ${show(right)}`;
}

function firstDifference(
	label: string,
	incremental: unknown,
	naive: unknown,
): string | null {
	const left = normalizeForCompare(incremental);
	const right = normalizeForCompare(naive);
	if (isDeepStrictEqual(left, right)) return null;
	return `${label} ${divergence(left, right, "")}`;
}

interface DocumentStateLike {
	readonly blockOrder: readonly string[];
	readonly documentProfile: unknown;
	indexOf(blockId: string): number;
	parentOf(blockId: string): string | null;
	childrenOf(blockId: string): readonly string[];
	preorderBlockIds(): readonly string[];
	preorderIndexOf(blockId: string): number;
	rootBlockIds(): readonly string[];
	rootBlockIndexOf(blockId: string): number;
}

type DocumentStateConstructor = new (
	doc: PenDocument,
	crdtDoc: unknown,
	registry: unknown,
	profile: unknown,
) => DocumentStateLike;

interface DecorationCollectorLike {
	refresh(trigger: { readonly kind: "full" }): {
		readonly set: {
			readonly decorations: readonly { readonly blockId: string }[];
			forBlock(blockId: string): readonly unknown[];
		};
	};
}

type DecorationCollectorConstructor = new (
	editor: Editor,
	emit: (event: unknown) => void,
) => DecorationCollectorLike;

interface PassIndexLike {
	readonly rootIds: readonly string[];
	readonly rootCount: ReadonlyMap<string, number>;
	readonly childrenByParent: ReadonlyMap<string, readonly string[]>;
	readonly parentsByChild: ReadonlyMap<string, readonly string[]>;
	readonly liveIds: ReadonlySet<string>;
	readonly unstoredListed: ReadonlySet<string>;
	rootIndicesOf(blockId: string): number[];
}

interface PassIndexEngine {
	readonly passIndex: PassIndexLike | null;
	buildPassIndex(): PassIndexLike;
	readonly parentIdIndex: unknown;
	buildParentIdIndex(): unknown;
}

/** The pass index's structure and every root's positions, as the pass reads them. */
function passIndexView(index: PassIndexLike): unknown {
	return {
		rootIds: index.rootIds,
		rootCount: index.rootCount,
		childrenByParent: index.childrenByParent,
		parentsByChild: index.parentsByChild,
		liveIds: index.liveIds,
		unstoredListed: index.unstoredListed,
		rootIndices: [...new Set(index.rootIds)]
			.sort()
			.map((id) => [id, index.rootIndicesOf(id)]),
	};
}

/** A: preorder, top-level, child, parent and position indexes against a document state built fresh from storage. */
export function checkDocumentIndex(editor: Editor): string[] {
	const state = editor.documentState as unknown as DocumentStateLike;
	const Fresh = state.constructor as DocumentStateConstructor;
	const fresh = new Fresh(
		editor.internals.doc as PenDocument,
		editor.internals.crdtDoc,
		editor.schema,
		state.documentProfile,
	);
	const ids = new Set<string>([
		...blocksOf(editor).keys(),
		...state.blockOrder,
		...fresh.blockOrder,
	]);
	const read = (source: DocumentStateLike) => ({
		blockOrder: [...source.blockOrder],
		preorder: [...source.preorderBlockIds()],
		rootBlockIds: [...source.rootBlockIds()],
		perBlock: [...ids]
			.sort()
			.map((id) => [
				id,
				source.indexOf(id),
				source.parentOf(id),
				[...source.childrenOf(id)],
				source.preorderIndexOf(id),
				source.rootBlockIndexOf(id),
			]),
	});
	const difference = firstDifference(
		"A document index",
		read(state),
		read(fresh),
	);
	return difference ? [difference] : [];
}

/** B: the change-summary block index against one rebuilt from the document, text lengths included. */
export function checkBlockIndex(editor: Editor, internals: AuditInternals): string[] {
	const index = (
		editor as unknown as { _blockIndex: { snapshot(): unknown } }
	)._blockIndex;
	const naive = internals.createBlockIndexSnapshotFromDocument(
		editor.internals.doc as PenDocument,
	);
	const difference = firstDifference(
		"B block index",
		index.snapshot(),
		naive,
	);
	return difference ? [difference] : [];
}

/**
 * B: every block whose stored type, props or text an operation changed, or
 * which it created or removed, is named by some commit's summary during it.
 */
export function checkTouchedIds(
	before: ReadonlyMap<string, string>,
	after: ReadonlyMap<string, string>,
	summaries: readonly ChangeSummary[],
): string[] {
	const touched = new Set<string>();
	for (const summary of summaries) {
		for (const id of summaryTouchedBlockIds(summary)) touched.add(id);
		for (const id of summary.affectedBlockIds) touched.add(id);
	}
	const missed: string[] = [];
	for (const id of new Set([...before.keys(), ...after.keys()])) {
		if (before.get(id) !== after.get(id) && !touched.has(id))
			missed.push(id);
	}
	if (missed.length === 0) return [];
	const states = missed.map(
		(id) =>
			`${id}: ${before.get(id) ?? "absent"} → ${after.get(id) ?? "absent"}`,
	);
	const structural = summaries.map((summary) =>
		JSON.stringify(summary.structural),
	);
	return [
		`B change-summary touched ids miss changed blocks ${JSON.stringify(missed)} (named: ${JSON.stringify([...touched])})\n  ${states.join("\n  ")}\n  summaries: ${structural.join("\n  ")}`,
	];
}

/**
 * The renderer-visible slices a notifier block snapshot derives from document
 * state. `commit.revision` is left out: core bumps a revision for every block
 * a local op wrote, even when the write changed nothing the summary names (a
 * `set-props` clearing an absent key), so it is not a function of the summaries
 * the notifier hears.
 */
function notifierView(notifier: AuditBlockNotifier, blockId: string): unknown {
	const snapshot = (
		notifier as unknown as {
			getBlockSnapshot(id: string): Record<string, unknown>;
		}
	).getBlockSnapshot(blockId);
	const commit = snapshot.commit as Record<string, unknown>;
	return {
		exists: commit.exists,
		type: commit.type,
		props: commit.props,
		selection: snapshot.selection,
		decorations: snapshot.decorations,
		childIds: snapshot.childIds,
		list: snapshot.list,
		isPlaceholderTarget: snapshot.isPlaceholderTarget,
	};
}

/** Ids listed more than once across the root order and every children array (COL4). */
function multiListedIds(editor: Editor): Set<string> {
	const doc = editor.internals.doc as PenDocument;
	const counts = new Map<string, number>();
	const count = (id: unknown) => {
		if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
	};
	for (const id of (
		doc.blockOrder as unknown as { toArray(): unknown[] }
	).toArray())
		count(id);
	for (const block of blocksOf(editor).values()) {
		const children = block.get("children") as
			{ toArray?(): unknown[] } | undefined;
		for (const id of children?.toArray?.() ?? []) count(id);
	}
	return new Set(
		[...counts].filter(([, total]) => total > 1).map(([id]) => id),
	);
}

interface NotifierDocument {
	readonly rootIds: readonly string[];
}

function documentOf(notifier: AuditBlockNotifier): NotifierDocument {
	return (
		notifier as unknown as { getDocumentSnapshot(): NotifierDocument }
	).getDocumentSnapshot();
}

/** A notifier's document snapshot with the root ids whose block is gone left out. */
function liveDocument(
	editor: Editor,
	notifier: AuditBlockNotifier,
): NotifierDocument {
	return {
		...documentOf(notifier),
		rootIds: documentOf(notifier).rootIds.filter(
			(id) => editor.getBlock(id) !== null,
		),
	};
}

/** What one `checkNotifier` pass compares, and how it labels what differs. */
interface NotifierComparison {
	readonly editor: Editor;
	readonly notifier: AuditBlockNotifier;
	readonly fresh: AuditBlockNotifier;
	readonly label: string;
	/** Whether a sibling list can be compared: no id twice, none dead, none listed elsewhere. */
	keyable(parentId: string | null): boolean;
	readonly multiListed: ReadonlySet<string>;
}

interface NotifierCheckOptions {
	readonly label?: string;
	/** Only these blocks are compared (a partial mount). */
	readonly subscribedBlocks?: ReadonlySet<string> | null;
	/** Root ids are compared live on both sides. */
	readonly detaches?: boolean;
}

/**
 * C: block list slices, child ids and sibling-list segments against a fresh,
 * detached notifier. A sibling list holding an id twice, an id another array
 * also lists, or an entry whose block a concurrent delete removed is skipped:
 * an undo or remote commit can leave each (COL4) until the next local pass
 * repairs it, a duplicate is unkeyable, a block has one list slice for two
 * lists, and only the attached notifier tracks which entries died. The
 * comparison resumes once the list is repaired. Root ids are compared live.
 */
function checkNotifier(
	editor: Editor,
	notifier: AuditBlockNotifier,
	subscribedParents: ReadonlySet<string | null>,
	internals: AuditInternals,
	{ label = "C", subscribedBlocks = null, detaches = false }: NotifierCheckOptions = {},
): string[] {
	const fresh = internals.createBlockNotifier(editor);
	try {
		const documentProblems = checkNotifierDocument(
			editor,
			notifier,
			fresh,
			label,
			detaches,
		);
		const multiListed = multiListedIds(editor);
		const keyable = (parentId: string | null) =>
			isKeyableList(
				editor,
				parentId === null
					? documentOf(fresh).rootIds
					: editor.documentState.childrenOf(parentId),
				multiListed,
			);
		const comparison: NotifierComparison = {
			editor,
			notifier,
			fresh,
			label,
			keyable,
			multiListed,
		};
		return [
			...documentProblems,
			...checkNotifierSegments(comparison, subscribedParents),
			...checkNotifierBlocks(comparison, subscribedBlocks),
		];
	} finally {
		fresh.destroy();
	}
}

/**
 * The document snapshot. A notifier that was detached when a concurrent
 * delete killed an entry draws it, as a fresh mount does, until a local pass
 * removes it; with `detaches` it must still list every live root.
 */
function checkNotifierDocument(
	editor: Editor,
	notifier: AuditBlockNotifier,
	fresh: AuditBlockNotifier,
	label: string,
	detaches: boolean,
): string[] {
	const naive = liveDocument(editor, fresh);
	const incremental = detaches
		? liveDocument(editor, notifier)
		: documentOf(notifier);
	const difference = firstDifference(
		`${label} document snapshot`,
		incremental,
		naive,
	);
	return difference ? [difference] : [];
}

function isKeyableList(
	editor: Editor,
	list: readonly string[],
	multiListed: ReadonlySet<string>,
): boolean {
	return (
		new Set(list).size === list.length &&
		list.every((id) => editor.getBlock(id) !== null && !multiListed.has(id))
	);
}

function checkNotifierSegments(
	{ notifier, fresh, label, keyable }: NotifierComparison,
	subscribedParents: ReadonlySet<string | null>,
): string[] {
	const problems: string[] = [];
	for (const parentId of subscribedParents) {
		if (!keyable(parentId)) continue;
		const difference = firstDifference(
			`${label} list segments of ${parentId ?? "root"}`,
			notifier.getListSegments(parentId),
			fresh.getListSegments(parentId),
		);
		if (difference) problems.push(difference);
	}
	return problems;
}

function checkNotifierBlocks(
	comparison: NotifierComparison,
	subscribedBlocks: ReadonlySet<string> | null,
): string[] {
	const { editor, notifier, fresh, label } = comparison;
	const problems: string[] = [];
	for (const blockId of editor.documentState.preorderBlockIds()) {
		if (subscribedBlocks && !subscribedBlocks.has(blockId)) continue;
		const difference = firstDifference(
			`${label} block snapshot ${blockId}`,
			comparedView(comparison, notifier, blockId),
			comparedView(comparison, fresh, blockId),
		);
		if (difference) problems.push(difference);
	}
	return problems;
}

/** A block's view, with its list slice masked while its sibling list is unrepaired. */
function comparedView(
	{ editor, keyable, multiListed }: NotifierComparison,
	source: AuditBlockNotifier,
	blockId: string,
): unknown {
	const read = notifierView(source, blockId) as Record<string, unknown>;
	return keyable(editor.documentState.parentOf(blockId)) &&
		!multiListed.has(blockId)
		? read
		: { ...read, list: "unrepaired sibling list" };
}

/**
 * D: merged decorations per rendered block against every source recomputed
 * over every block. A scoped source can hold decorations for a stored block
 * no array reaches (a COL4 orphan); nothing renders them, so only preorder
 * blocks are compared.
 */
function checkDecorations(editor: Editor): string[] {
	const collector = (
		editor as unknown as { _decorationCollector: DecorationCollectorLike }
	)._decorationCollector;
	const Fresh = collector.constructor as DecorationCollectorConstructor;
	const naive = new Fresh(editor, () => {}).refresh({ kind: "full" }).set;
	const incremental = editor.getDecorations();
	const ids = editor.documentState.preorderBlockIds();
	const read = (set: { forBlock(blockId: string): readonly unknown[] }) =>
		ids.map((id) => [id, set.forBlock(id)]);
	const difference = firstDifference(
		"D decorations per block",
		read(incremental),
		read(naive),
	);
	return difference ? [difference] : [];
}

/** E: the AI controller's suggestion list against the whole-document walk. */
function checkSuggestions(editor: Editor): string[] {
	const controller = getAIController(editor);
	if (!controller) return ["E: the AI controller is not active"];
	const difference = firstDifference(
		"E suggestion list",
		controller.getSuggestions(),
		readAllSuggestions(editor),
	);
	return difference ? [difference] : [];
}

/** F: the search controller's matches against a full rescan for the active query. */
export function checkSearch(editor: Editor): string[] {
	const controller = getSearchController(editor);
	if (!controller) return ["F: the search controller is not active"];
	const state = controller.getState();
	const difference = firstDifference(
		"F search matches",
		state.matches,
		findDocumentMatches(editor, state.query, state.options),
	);
	return difference ? [difference] : [];
}

/** G: the held normalization pass index and Rule 10 `parentId` index against ones built fresh from the document. */
export function checkPassIndex(editor: Editor): string[] {
	const engine = editor.internals.engine as unknown as PassIndexEngine;
	const problems: string[] = [];
	if (engine.passIndex !== null) {
		const difference = firstDifference(
			"G normalization pass index",
			passIndexView(engine.passIndex),
			passIndexView(engine.buildPassIndex()),
		);
		if (difference) problems.push(difference);
	}
	// Rule 10's `parentId` index, once a delete built it.
	if (engine.parentIdIndex !== null) {
		const difference = firstDifference(
			"G normalization parentId index",
			engine.parentIdIndex,
			engine.buildParentIdIndex(),
		);
		if (difference) problems.push(difference);
	}
	return problems;
}

/** Blocks and segment channels a churning mount reads before an operation and subscribes after it. */
const CHURN_READS = 6;
const CHURN_SEGMENT_READS = 2;
/** Chance per step that every churn subscription is released, so the notifier detaches. */
const CHURN_RELEASE_ALL = 0.1;
/** Operations a released-all mount stays detached for, at most. */
const CHURN_DETACHED_STEPS = 4;
/** Chance per subscription per step that it is released. */
const CHURN_RELEASE = 0.1;
/** Chance per step that an already-called unsubscribe is called again. */
const CHURN_STALE = 0.25;

interface ChurnMount {
	/** Reads a few blocks and segment lists the way a renderer reads before it subscribes. */
	render(): string;
	/** Subscribes what `render` read, releases some subscriptions, and re-calls a released one. */
	effects(): string;
	/** Every subscription whose current value differs from the last one it was notified of. */
	missedNotifications(): string[];
	/** Releases every subscription now and stays detached through the next operation. */
	detach(): string;
	readonly notifier: AuditBlockNotifier;
	readonly blocks: ReadonlySet<string>;
	readonly parents: ReadonlySet<string | null>;
	destroy(): void;
}

interface ChurnSubscription {
	readonly unsubscribe: Unsubscribe;
	/** What the subscriber last read: at subscribe, then at each notification. */
	seen: unknown;
}

/**
 * A second notifier mounted the way a remounting or virtualizing renderer
 * mounts: blocks and segment channels are read before they subscribe, with
 * an operation between the two (React reads in render and subscribes in a
 * passive effect); a random subset is subscribed, segment channels without
 * their container's block; subscriptions churn, now and then all of them for
 * a few operations, so the notifier detaches and re-attaches; and released
 * unsubscribes are called again. Each subscriber re-reads when notified, so
 * a value that moved without a notification is caught
 * (`useSyncExternalStore`'s contract).
 */
function createChurnMount(
	editor: Editor,
	notifier: AuditBlockNotifier,
	rng: Rng,
): ChurnMount {
	const blockSubscriptions = new Map<string, ChurnSubscription>();
	const segmentSubscriptions = new Map<string | null, ChurnSubscription>();
	const released: Unsubscribe[] = [];
	let pendingBlocks: string[] = [];
	let pendingParents: (string | null)[] = [];
	let detachedFor = 0;
	const read = notifier as unknown as {
		getBlockSnapshot(id: string): unknown;
	};
	const live = () => editor.documentState.preorderBlockIds();
	const containers = (): (string | null)[] => [
		null,
		...live().filter(
			(id) => editor.documentState.childrenOf(id).length > 0,
		),
	];
	const sample = <T>(items: readonly T[], count: number): T[] => {
		const picked = new Set<T>();
		for (let tries = 0; tries < count * 2 && picked.size < count; tries += 1)
			if (items.length > 0) picked.add(rng.pick(items));
		return [...picked];
	};
	const subscribeBlock = (id: string) => {
		const subscription: ChurnSubscription = {
			unsubscribe: notifier.subscribeBlock(id, () => {
				subscription.seen = read.getBlockSnapshot(id);
			}),
			seen: undefined,
		};
		subscription.seen = read.getBlockSnapshot(id);
		blockSubscriptions.set(id, subscription);
	};
	const subscribeParent = (parentId: string | null) => {
		const subscription: ChurnSubscription = {
			unsubscribe: notifier.subscribeListSegments(parentId, () => {
				subscription.seen = notifier.getListSegments(parentId);
			}),
			seen: undefined,
		};
		subscription.seen = notifier.getListSegments(parentId);
		segmentSubscriptions.set(parentId, subscription);
	};
	const release = <K>(subscriptions: Map<K, ChurnSubscription>, key: K) => {
		const subscription = subscriptions.get(key);
		if (!subscription) return;
		subscription.unsubscribe();
		released.push(subscription.unsubscribe);
		subscriptions.delete(key);
	};
	const releaseAll = () => {
		for (const id of [...blockSubscriptions.keys()])
			release(blockSubscriptions, id);
		for (const parentId of [...segmentSubscriptions.keys()])
			release(segmentSubscriptions, parentId);
	};
	/** Subscribes what `render` read and is still in the document. */
	const subscribePending = (ids: ReadonlySet<string>) => {
		for (const id of pendingBlocks) {
			if (ids.has(id) && !blockSubscriptions.has(id)) subscribeBlock(id);
		}
		for (const parentId of pendingParents) {
			if (parentId !== null && !ids.has(parentId)) continue;
			if (!segmentSubscriptions.has(parentId)) subscribeParent(parentId);
		}
	};
	/** Releases every subscription whose block left, and a random few more. */
	const releaseSome = (ids: ReadonlySet<string>) => {
		for (const id of [...blockSubscriptions.keys()]) {
			if (!ids.has(id) || rng.chance(CHURN_RELEASE))
				release(blockSubscriptions, id);
		}
		for (const parentId of [...segmentSubscriptions.keys()]) {
			const gone = parentId !== null && !ids.has(parentId);
			if (gone || rng.chance(CHURN_RELEASE))
				release(segmentSubscriptions, parentId);
		}
	};
	/** Now and then calls an already-released unsubscribe again. */
	const callStaleUnsubscribe = (): boolean => {
		if (released.length === 0 || !rng.chance(CHURN_STALE)) return false;
		rng.pick(released)();
		return true;
	};
	return {
		notifier,
		get blocks() {
			return new Set(blockSubscriptions.keys());
		},
		get parents() {
			return new Set(segmentSubscriptions.keys());
		},
		render() {
			if (detachedFor === 0 && rng.chance(CHURN_RELEASE_ALL)) {
				releaseAll();
				detachedFor = 1 + rng.int(CHURN_DETACHED_STEPS);
				return `churn release all for ${detachedFor} ops`;
			}
			if (detachedFor > 0) return "churn detached";
			pendingBlocks = sample(
				live().filter((id) => !blockSubscriptions.has(id)),
				CHURN_READS,
			);
			pendingParents = sample(
				containers().filter((id) => !segmentSubscriptions.has(id)),
				CHURN_SEGMENT_READS,
			);
			for (const id of pendingBlocks) read.getBlockSnapshot(id);
			for (const parentId of pendingParents)
				notifier.getListSegments(parentId);
			return `churn read ${JSON.stringify(pendingBlocks)} segments ${JSON.stringify(pendingParents)}`;
		},
		effects() {
			if (detachedFor > 0) {
				detachedFor -= 1;
				pendingBlocks = [];
				pendingParents = [];
				return "churn detached";
			}
			const ids = new Set(live());
			subscribePending(ids);
			releaseSome(ids);
			const notes = callStaleUnsubscribe() ? ["stale unsubscribe"] : [];
			notes.push(
				`subscribed ${blockSubscriptions.size} blocks, segments ${JSON.stringify([...segmentSubscriptions.keys()])}`,
			);
			return `churn ${notes.join(", ")}`;
		},
		detach() {
			releaseAll();
			// `effects` of this step counts it down; the next step stays detached.
			detachedFor = 2;
			pendingBlocks = [];
			pendingParents = [];
			return "churn release all mid-op";
		},
		missedNotifications() {
			const missed: string[] = [];
			for (const [id, subscription] of blockSubscriptions) {
				if (read.getBlockSnapshot(id) !== subscription.seen)
					missed.push(`C churn block ${id} changed without notifying`);
			}
			for (const [parentId, subscription] of segmentSubscriptions) {
				if (notifier.getListSegments(parentId) !== subscription.seen)
					missed.push(
						`C churn list segments of ${parentId ?? "root"} changed without notifying`,
					);
			}
			return missed;
		},
		destroy() {
			releaseAll();
			notifier.destroy();
		},
	};
}

export interface PropertyCase {
	/** The first peer; every peer carries the same stack and is checked alike. */
	readonly editor: TestEditor;
	/** Every peer, in harness order (`a`, `b`, …). */
	readonly editors: readonly TestEditor[];
	/** Every write, delivery and history step so far, one per line. */
	trace(): string;
	/** Runs one random operation; returns its label. */
	step(): string;
	/** Every cache that differs from its naive recompute after the last step, on any peer. */
	check(): string[];
	destroy(): void;
}

export interface PropertyCaseOptions {
	/** The operations the walk draws from; every one by default. A narrower pool reproduces one finding. */
	readonly ops?: readonly PropertyOp[];
}

/** One forked peer: its editor, the notifier subscribed like a renderer, and what the step saw. */
interface PeerState {
	readonly index: number;
	readonly label: string;
	readonly editor: TestEditor;
	readonly notifier: AuditBlockNotifier;
	readonly blockSubscriptions: Map<string, Unsubscribe>;
	readonly segmentSubscriptions: Map<string | null, Unsubscribe>;
	readonly offDocument: Unsubscribe;
	readonly offCommit: Unsubscribe;
	readonly summaries: ChangeSummary[];
	before: Map<string, string>;
	stream: TextStreamWriter | null;
	/** A second notifier mounted the way a remounting renderer mounts. */
	readonly churn: ChurnMount;
}

/** Ops `multi-op` batches into one apply; split and merge go through their helpers. */
const BATCHABLE_OPS = [
	"keystroke",
	"delete-text",
	"insert-root",
	"insert-children",
	"insert-parent-id",
	"move-root",
	"move-children",
	"move-parent-id",
	"reorder-parent-id",
	"unparent",
	"delete-block",
	"indent",
	"type-change",
	"format",
] as const satisfies readonly PropertyOp[];

type BatchableOp = (typeof BATCHABLE_OPS)[number];

/** Containers a `children` array can hold blocks under; blockquotes start with none. */
const CHILDREN_CONTAINERS = ["callout", "blockquote"] as const;

export function mergeStateVectors(vectors: readonly Uint8Array[]): Uint8Array {
	const merged = new Map<number, number>();
	for (const vector of vectors) {
		for (const [client, clock] of Y.decodeStateVector(vector)) {
			merged.set(client, Math.max(merged.get(client) ?? 0, clock));
		}
	}
	return Y.encodeStateVector(merged);
}

/**
 * Builds one seeded case: `PEER_COUNT` forked peers, each with the realistic
 * stack (undo, streams, tools, AI, search) and a block notifier subscribed
 * like a renderer without virtualization. Any peer writes, undoes or streams;
 * deliveries run whole, merged, or out of order (a peer's update encoded
 * against partial state vectors, so it lands before the updates it depends
 * on). Every cache is checked on every peer after every step.
 */
export function createPropertyCase(
	seed: number,
	internals: AuditInternals,
	options: PropertyCaseOptions = {},
): PropertyCase {
	const pool = options.ops ?? PROPERTY_OPS;
	const rng = createRng(seed);
	const harness: PeerHarness = createPeerHarness(PEER_COUNT, {
		blocks: [...generateMixedBlockSpecs(ROOT_COUNT), ...calloutBlocks()],
		extensionsFor: () => [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({
				suggestMode: false,
				model: createModelDouble({ parts: [] }),
			}),
			searchExtension(),
		],
	});
	const trace: string[] = [];
	let serial = 0;
	const newId = (prefix: string) => `${prefix}-${seed}-${(serial += 1)}`;
	const noop = () => {};

	const peers: PeerState[] = harness.peers.map((peer) => {
		const editor = peer.editor;
		// The test editor's `getBlock` throws for a missing block; the caches
		// read removed blocks and expect null, as the runtime returns.
		delete (editor as { getBlock?: unknown }).getBlock;
		const search = getSearchController(editor);
		search?.setQuery(SEARCH_QUERY);
		search?.open();
		const notifier = internals.createBlockNotifier(editor);
		const summaries: ChangeSummary[] = [];
		return {
			index: peer.index,
			label: peer.label,
			editor,
			notifier,
			blockSubscriptions: new Map(),
			segmentSubscriptions: new Map(),
			offDocument: notifier.subscribeDocument(noop),
			offCommit: editor.on("commit", (event: CommitEvent) => {
				summaries.push(event.summary);
			}),
			summaries,
			before: storedBlockStates(editor),
			stream: null,
			// Its own stream, so the operation walk is the same with or without it.
			churn: createChurnMount(
				editor,
				internals.createBlockNotifier(editor),
				createRng((seed ^ 0x9e3779b9) + peer.index),
			),
		};
	});
	const peerOf = (target: Editor): PeerState =>
		peers.find((peer) => peer.editor === target)!;

	/** Mounts what a renderer would mount now: every block, and a segment list per sibling list. */
	const remount = (peer: PeerState) => {
		const state = peer.editor.documentState;
		const live = new Set(state.preorderBlockIds());
		for (const [id, unsubscribe] of peer.blockSubscriptions) {
			if (live.has(id)) continue;
			unsubscribe();
			peer.blockSubscriptions.delete(id);
		}
		const parents = new Set<string | null>([null]);
		for (const id of live) {
			if (!peer.blockSubscriptions.has(id))
				peer.blockSubscriptions.set(
					id,
					peer.notifier.subscribeBlock(id, noop),
				);
			if (state.childrenOf(id).length > 0) parents.add(id);
		}
		for (const [parentId, unsubscribe] of peer.segmentSubscriptions) {
			if (parents.has(parentId)) continue;
			unsubscribe();
			peer.segmentSubscriptions.delete(parentId);
		}
		for (const parentId of parents) {
			if (peer.segmentSubscriptions.has(parentId)) continue;
			peer.segmentSubscriptions.set(
				parentId,
				peer.notifier.subscribeListSegments(parentId, noop),
			);
			peer.notifier.getListSegments(parentId);
		}
	};
	for (const peer of peers) remount(peer);

	const liveIds = (target: Editor) =>
		[...target.documentState.preorderBlockIds()].filter(
			(id) => target.getBlock(id) !== null,
		);
	const textIds = (target: Editor) =>
		liveIds(target).filter((id) => {
			const block = target.getBlock(id);
			return (
				block !== null &&
				(TEXT_TYPES as readonly string[]).includes(block.type)
			);
		});
	const rootIds = (target: Editor) =>
		liveIds(target).filter(
			(id) => target.documentState.parentOf(id) === null,
		);
	const textLength = (target: Editor, id: string) =>
		target.getBlock(id)?.textContent().length ?? 0;
	const isAncestor = (
		target: Editor,
		ancestorId: string,
		blockId: string,
	) => {
		for (
			let at: string | null = blockId;
			at !== null;
			at = target.documentState.parentOf(at)
		) {
			if (at === ancestorId) return true;
		}
		return false;
	};
	const containers = (target: Editor, ...types: readonly string[]) =>
		liveIds(target).filter((id) =>
			types.includes(target.getBlock(id)?.type ?? ""),
		);
	const parentIdChildren = (target: Editor, toggle: string) =>
		target.documentState
			.childrenOf(toggle)
			.filter(
				(id) =>
					target.getBlock(id)?.props.parentId === toggle &&
					target.documentState.blockOrder.includes(id),
			);

	const labelOf = (target: Editor) => peerOf(target).label;
	const apply = (
		target: Editor,
		ops: DocumentOp[],
		origin: Parameters<Editor["apply"]>[1] = { origin: "user" },
	) => {
		if (ops.length === 0) return;
		trace.push(`${labelOf(target)} ${JSON.stringify(ops)}`);
		try {
			target.apply(ops, origin);
		} catch {
			// An op the random walk built against a block another op changed;
			// rejection is the pipeline's business, not the caches'.
		}
	};

	/** A `move-block` of `blockId`, clearing a `parentId` the new route would contradict. */
	const moveOps = (
		target: Editor,
		blockId: string,
		position: Extract<DocumentOp, { type: "move-block" }>["position"],
	): DocumentOp[] => {
		const ops: DocumentOp[] = [{ type: "move-block", blockId, position }];
		if (target.getBlock(blockId)?.props.parentId)
			ops.push({ type: "set-props", blockId, props: { parentId: null } });
		return ops;
	};

	/** Where `insert-root` lands: an end of the document now and then, else after a random root. */
	const rootInsertPosition = (
		target: Editor,
	): Extract<DocumentOp, { type: "insert-block" }>["position"] => {
		const roots = rootIds(target);
		if (roots.length > 0 && !rng.chance(0.1)) return { after: rng.pick(roots) };
		return rng.chance(0.5) ? "first" : "last";
	};

	/** One random write's ops per batchable op, each built against `target`'s current document. */
	const opBuilders: Record<BatchableOp, (target: Editor) => DocumentOp[]> = {
		keystroke: (target) => {
			const blockId = rng.pick(textIds(target));
			if (!blockId) return [];
			const at = rng.int(textLength(target, blockId) + 1);
			const insert = rng.pick(TYPED);
			return [{ type: "splice-text", blockId, from: at, to: at, insert }];
		},
		"delete-text": (target) => {
			const blockId = rng.pick(textIds(target));
			if (!blockId) return [];
			const length = textLength(target, blockId);
			const from = rng.int(length + 1);
			const to = Math.min(length, from + 1 + rng.int(4));
			return [{ type: "splice-text", blockId, from, to, insert: "" }];
		},
		"insert-root": (target) => {
			const position = rootInsertPosition(target);
			return [
				{
					type: "insert-block",
					blockId: newId("root"),
					blockType: rng.pick(TEXT_TYPES),
					props: { indent: rng.int(2) },
					position,
				},
			];
		},
		"insert-children": (target) => {
			const parent = rng.pick(containers(target, ...CHILDREN_CONTAINERS));
			if (!parent) return [];
			return [
				{
					type: "insert-block",
					blockId: newId("child"),
					blockType: rng.pick(LIST_TYPES),
					props: { indent: rng.int(2) },
					position: {
						parent,
						index: rng.int(target.documentState.childrenOf(parent).length + 1),
					},
				},
			];
		},
		"insert-parent-id": (target) => {
			const toggle = rng.pick(containers(target, "toggle"));
			if (!toggle) return [];
			const siblings = target.documentState.childrenOf(toggle);
			const after =
				siblings.length > 0 && rng.chance(0.5) ? rng.pick(siblings) : toggle;
			return [
				{
					type: "insert-block",
					blockId: newId("nested"),
					blockType: rng.pick(TEXT_TYPES),
					props: { parentId: toggle },
					position: { after },
				},
			];
		},
		"move-root": (target) => {
			const blockId = rng.pick(liveIds(target));
			const roots = rootIds(target).filter(
				(id) => !isAncestor(target, blockId ?? "", id),
			);
			if (!blockId || roots.length === 0) return [];
			return moveOps(target, blockId, { after: rng.pick(roots) });
		},
		"move-children": (target) => {
			const texts = textIds(target);
			const parent = rng.pick(containers(target, ...CHILDREN_CONTAINERS));
			const blockId = rng.pick(texts);
			if (!parent || !blockId || isAncestor(target, blockId, parent)) return [];
			return moveOps(target, blockId, {
				parent,
				index: rng.int(target.documentState.childrenOf(parent).length + 1),
			});
		},
		"move-parent-id": (target) => {
			const texts = textIds(target);
			const toggle = rng.pick(containers(target, "toggle"));
			const blockId = rng.pick(
				texts.filter((id) => target.documentState.blockOrder.includes(id)),
			);
			if (!toggle || !blockId || isAncestor(target, blockId, toggle)) return [];
			return [
				{ type: "move-block", blockId, position: { after: toggle } },
				{ type: "set-props", blockId, props: { parentId: toggle } },
			];
		},
		"reorder-parent-id": (target) => {
			// Several `parentId` siblings move in one apply, each after
			// another sibling (or the toggle), so the held sibling order
			// changes more than once in a transaction.
			const toggle = rng.pick(
				containers(target, "toggle").filter(
					(id) => parentIdChildren(target, id).length >= 2,
				),
			);
			if (!toggle) return [];
			const siblings = parentIdChildren(target, toggle);
			const ops: DocumentOp[] = [];
			const moves = 2 + rng.int(2);
			for (let move = 0; move < moves; move += 1) {
				const blockId = rng.pick(siblings);
				const others = siblings.filter((id) => id !== blockId);
				const after = rng.chance(0.2) ? toggle : rng.pick(others);
				ops.push({ type: "move-block", blockId, position: { after } });
			}
			return ops;
		},
		unparent: (target) => {
			const blockId = rng.pick(
				liveIds(target).filter((id) => {
					const parentId = target.getBlock(id)?.props.parentId;
					return typeof parentId === "string" && parentId !== "";
				}),
			);
			if (!blockId) return [];
			return [{ type: "set-props", blockId, props: { parentId: null } }];
		},
		"delete-block": (target) => {
			const all = liveIds(target);
			const blockId = rng.pick(all);
			if (!blockId || all.length < 8) return [];
			return [{ type: "delete-block", blockId }];
		},
		indent: (target) => {
			const blockId = rng.pick(
				liveIds(target).filter((id) =>
					(LIST_TYPES as readonly string[]).includes(
						target.getBlock(id)?.type ?? "",
					),
				),
			);
			if (!blockId) return [];
			const indent = Number(target.getBlock(blockId)?.props.indent ?? 0);
			const next = Math.max(
				0,
				Math.min(MAX_INDENT, indent + (rng.chance(0.5) ? 1 : -1)),
			);
			return [{ type: "set-props", blockId, props: { indent: next } }];
		},
		"type-change": (target) => {
			const blockId = rng.pick(textIds(target));
			if (!blockId) return [];
			return [
				{ type: "set-props", blockId, props: { type: rng.pick(TEXT_TYPES) } },
			];
		},
		format: (target) => {
			const blockId = rng.pick(textIds(target));
			if (!blockId) return [];
			const length = textLength(target, blockId);
			if (length === 0) return [];
			const from = rng.int(length);
			return [
				{
					type: "format-text",
					blockId,
					from,
					to: Math.min(length, from + 3),
					marks: { bold: rng.chance(0.7) ? true : null },
				},
			];
		},
	};

	/** One random write's ops on `target`, built against its current document. */
	const buildOps = (target: Editor, op: BatchableOp): DocumentOp[] =>
		opBuilders[op](target);

	const splitRandom = (target: Editor) => {
		const blockId = rng.pick(textIds(target));
		if (!blockId) return;
		const offset = rng.int(textLength(target, blockId) + 1);
		const newBlockId = newId("split");
		trace.push(`${labelOf(target)} split ${blockId}@${offset} → ${newBlockId}`);
		applySplitBlock(target, {
			blockId,
			offset,
			newBlockId,
			applyOptions: { origin: "user" },
		});
	};

	const mergeRandom = (target: Editor) => {
		const texts = textIds(target);
		const sourceBlockId = rng.pick(texts);
		if (!sourceBlockId) return;
		const targetBlockId = texts[texts.indexOf(sourceBlockId) - 1];
		if (!targetBlockId || isAncestor(target, sourceBlockId, targetBlockId)) return;
		trace.push(`${labelOf(target)} merge ${sourceBlockId} into ${targetBlockId}`);
		try {
			applyMergeBlocks(target, {
				targetBlockId,
				sourceBlockId,
				applyOptions: { origin: "user" },
			});
		} catch {
			// See `apply`.
		}
	};

	/** Applies one random op's batch; a keystroke puts the caret after what it typed. */
	const writeBatch = (target: Editor, op: BatchableOp) => {
		const ops = buildOps(target, op);
		apply(target, ops);
		const first = ops[0];
		if (op !== "keystroke" || first?.type !== "splice-text") return;
		if (typeof first.insert !== "string") return;
		const at = first.from + first.insert.length;
		target.selectText(first.blockId, at, at);
	};

	/** One random write on `target`: one op's batch, or a split or merge through its helper. */
	const write = (target: Editor, op: BatchableOp | "split" | "merge") => {
		if (op === "split") splitRandom(target);
		else if (op === "merge") mergeRandom(target);
		else writeBatch(target, op);
	};

	const pickPeer = (): PeerState => rng.pick(peers);
	const pickOtherPeer = (peer: PeerState): PeerState =>
		rng.pick(peers.filter((other) => other !== peer));

	const deliver = (from: PeerState, to: PeerState) => {
		trace.push(`deliver ${from.label} → ${to.label}`);
		harness.deliver(from.index, to.index, {
			via: rng.chance(0.5) ? "adapter" : "provider",
		});
	};

	/** Two peers' updates against `to`'s state, merged into one update. */
	const deliverMerged = (to: PeerState) => {
		const sources = peers.filter((peer) => peer !== to);
		const first = rng.pick(sources);
		const second = rng.pick(sources.filter((peer) => peer !== first));
		const since = harness.stateVector(to.index);
		trace.push(`deliver merged ${first.label}+${second.label} → ${to.label}`);
		harness.applyUpdateTo(
			to.index,
			Y.mergeUpdates([
				harness.encodeUpdate(first.index, since),
				harness.encodeUpdate(second.index, since),
			]),
		);
	};

	/**
	 * `from`'s update encoded against `to`'s and `via`'s state vectors, so it
	 * leaves out what `from` learned from `via`: it lands on `to` before the
	 * updates it depends on, which `via` delivers after (or a later step does).
	 */
	const deliverOutOfOrder = (from: PeerState, to: PeerState, via: PeerState) => {
		const since = mergeStateVectors([
			harness.stateVector(to.index),
			harness.stateVector(via.index),
		]);
		trace.push(
			`deliver ${from.label} → ${to.label} without ${via.label}'s state`,
		);
		harness.applyUpdateTo(to.index, harness.encodeUpdate(from.index, since));
		if (rng.chance(0.7)) deliver(via, to);
	};

	/** Delivers `left` and `right` to each other in a random order, or leaves it for a later step. */
	const exchange = (left: PeerState, right: PeerState) => {
		if (rng.chance(0.2)) return;
		if (rng.chance(0.5)) {
			deliver(left, right);
			deliver(right, left);
		} else {
			deliver(right, left);
			deliver(left, right);
		}
	};

	const undoOrRedo = (peer: PeerState, op: "undo" | "redo") => {
		const manager = peer.editor.facet(undoManagerFacet) as UndoManager | null;
		manager?.stopCapturing();
		trace.push(
			`${peer.label} ${op} → ${String(op === "undo" ? manager?.undo() : manager?.redo())}`,
		);
	};

	/**
	 * Two peers sync one way, then each moves one text block both hold with
	 * `move`, at once. Returns the pair, or null when they share no text block.
	 */
	const race = (
		move: (peer: PeerState, blockId: string) => void,
	): [PeerState, PeerState] | null => {
		const left = pickPeer();
		const right = pickOtherPeer(left);
		deliver(left, right);
		const blockId = rng.pick(
			textIds(left.editor).filter((id) => right.editor.getBlock(id)),
		);
		if (!blockId) return null;
		for (const peer of [left, right]) move(peer, blockId);
		return [left, right];
	};

	/** Two peers move one block to different root positions at once: the merge lists it in two root entries (COL4). */
	const raceMoveRoot = () => {
		const pair = race((peer, blockId) => {
			const roots = rootIds(peer.editor).filter(
				(id) => !isAncestor(peer.editor, blockId, id),
			);
			if (roots.length === 0) return;
			apply(
				peer.editor,
				moveOps(peer.editor, blockId, { after: rng.pick(roots) }),
			);
		});
		if (pair) exchange(...pair);
	};

	/** Two peers move one block into two different containers, then one or both undo the move. */
	const raceMoveContainers = () => {
		const pair = race((peer, blockId) => {
			const parent = rng.pick(
				containers(peer.editor, ...CHILDREN_CONTAINERS).filter(
					(id) => !isAncestor(peer.editor, blockId, id),
				),
			);
			if (!parent) return;
			(peer.editor.facet(undoManagerFacet) as UndoManager | null)?.stopCapturing();
			apply(
				peer.editor,
				moveOps(peer.editor, blockId, {
					parent,
					index: rng.int(peer.editor.documentState.childrenOf(parent).length + 1),
				}),
			);
		});
		if (!pair) return;
		const [left, right] = pair;
		exchange(left, right);
		undoOrRedo(left, "undo");
		if (rng.chance(0.5)) undoOrRedo(right, "undo");
		if (rng.chance(0.5)) exchange(left, right);
	};

	const runOp = (op: PropertyOp): void => {
		switch (op) {
			case "keystroke":
			case "delete-text":
			case "split":
			case "merge":
			case "insert-root":
			case "insert-children":
			case "insert-parent-id":
			case "move-root":
			case "move-children":
			case "move-parent-id":
			case "reorder-parent-id":
			case "unparent":
			case "delete-block":
			case "indent":
			case "type-change":
			case "format":
				write(pickPeer().editor, op);
				return;
			case "multi-op": {
				const target = pickPeer().editor;
				const ops: DocumentOp[] = [];
				const count = 2 + rng.int(3);
				for (let index = 0; index < count; index += 1)
					ops.push(...buildOps(target, rng.pick(BATCHABLE_OPS)));
				apply(target, ops);
				return;
			}
			case "undo":
			case "redo":
				undoOrRedo(pickPeer(), op);
				return;
			case "stream-open": {
				const peer = pickPeer();
				const blockId = rng.pick(textIds(peer.editor));
				if (peer.stream || !blockId) return;
				trace.push(`${peer.label} open stream on ${blockId}`);
				peer.stream = peer.editor.openTextStream(
					{ blockId },
					{ origin: { type: "ai", requestId: newId("stream") } },
				);
				return;
			}
			case "stream-append": {
				const peer = rng.pick(peers.filter((entry) => entry.stream));
				if (!peer?.stream) return;
				const text = rng.pick([" fox", " streamed", "ox"]);
				trace.push(`${peer.label} stream append ${JSON.stringify(text)}`);
				peer.stream.append(text);
				peer.stream.flush();
				return;
			}
			case "stream-close": {
				const peer = rng.pick(peers.filter((entry) => entry.stream));
				if (!peer?.stream) return;
				trace.push(`${peer.label} stream close`);
				const stream = peer.stream;
				peer.stream = null;
				stream.close();
				return;
			}
			case "deliver": {
				const from = pickPeer();
				deliver(from, pickOtherPeer(from));
				return;
			}
			case "deliver-merged":
				deliverMerged(pickPeer());
				return;
			case "deliver-out-of-order": {
				const from = pickPeer();
				const to = pickOtherPeer(from);
				const via = rng.pick(
					peers.filter((peer) => peer !== from && peer !== to),
				);
				// `from` learns `via`'s state first, then writes on top of it.
				deliver(via, from);
				write(from.editor, rng.pick(BATCHABLE_OPS));
				deliverOutOfOrder(from, to, via);
				return;
			}
			case "sync-all":
				trace.push("sync all");
				harness.syncAll();
				return;
			case "race-move-root":
				raceMoveRoot();
				return;
			case "race-move-containers":
				raceMoveContainers();
				return;
			case "race-first-child": {
				// Two peers insert the first child of an empty container at
				// once; each creates the container's `children` array.
				const left = pickPeer();
				const right = pickOtherPeer(left);
				deliver(left, right);
				deliver(right, left);
				const parent = rng.pick(
					containers(left.editor, ...CHILDREN_CONTAINERS).filter(
						(id) =>
							left.editor.documentState.childrenOf(id).length === 0 &&
							right.editor.getBlock(id) !== null,
					),
				);
				if (!parent) return;
				const inserted: [PeerState, string][] = [];
				for (const peer of [left, right]) {
					const blockId = newId("first");
					inserted.push([peer, blockId]);
					apply(peer.editor, [
						{
							type: "insert-block",
							blockId,
							blockType: rng.pick(TEXT_TYPES),
							props: {},
							position: { parent, index: 0 },
						},
					]);
				}
				if (rng.chance(0.5)) {
					const [peer, blockId] = rng.pick(inserted);
					apply(peer.editor, [{ type: "delete-block", blockId }]);
				}
				exchange(left, right);
				return;
			}
			case "concurrent-delete-move": {
				// COL4: a delete against a peer's move leaves a dead order entry
				// on the deleting peer until its next local pass; an undo
				// straight after brings the block back without a pass between.
				const local = pickPeer();
				const remote = pickOtherPeer(local);
				deliver(local, remote);
				const blockId = rng.pick(
					rootIds(local.editor).filter(
						(id) => remote.editor.getBlock(id) !== null,
					),
				);
				const roots = rootIds(remote.editor).filter((id) => id !== blockId);
				if (
					!blockId ||
					roots.length === 0 ||
					liveIds(local.editor).length < 8
				)
					return;
				apply(local.editor, [{ type: "delete-block", blockId }]);
				apply(remote.editor, [
					{
						type: "move-block",
						blockId,
						position: { after: rng.pick(roots) },
					},
				]);
				deliver(remote, local);
				if (rng.chance(0.5)) {
					// The churn notifier saw the entry die; it hears the undo
					// only once it re-attaches.
					if (rng.chance(0.5)) trace.push(local.churn.detach());
					undoOrRedo(local, "undo");
				}
				return;
			}
			case "ai-suggest": {
				const peer = pickPeer();
				const controller = getAIController(peer.editor);
				const blockId = rng.pick(textIds(peer.editor));
				if (!controller || !blockId) return;
				controller.setSuggestMode(true);
				try {
					const at = rng.int(textLength(peer.editor, blockId) + 1);
					apply(
						peer.editor,
						[
							{
								type: "splice-text",
								blockId,
								from: at,
								to: at,
								insert: rng.pick([" suggested", " fox"]),
							},
						],
						{ origin: { type: "ai" } },
					);
				} finally {
					controller.setSuggestMode(false);
				}
				return;
			}
			case "resolve-suggestion": {
				const peer = pickPeer();
				const controller = getAIController(peer.editor);
				const suggestion = controller
					? rng.pick(controller.getSuggestions())
					: undefined;
				if (!controller || !suggestion) return;
				const accept = rng.chance(0.5);
				trace.push(
					`${peer.label} ${accept ? "accept" : "reject"} suggestion in ${suggestion.blockId}`,
				);
				if (accept) controller.acceptSuggestion(suggestion.id);
				else controller.rejectSuggestion(suggestion.id);
				return;
			}
			case "select": {
				const editor = pickPeer().editor;
				const ids = textIds(editor);
				if (ids.length === 0) return;
				const kind = rng.int(3);
				if (kind === 0) {
					const blockId = rng.pick(ids);
					const at = rng.int(textLength(editor, blockId) + 1);
					editor.selectText(blockId, at, at);
				} else if (kind === 1) {
					const anchor = rng.pick(ids);
					const focus = rng.pick(ids);
					editor.setSelection({
						type: "text",
						anchor: {
							blockId: anchor,
							offset: rng.int(textLength(editor, anchor) + 1),
						},
						focus: {
							blockId: focus,
							offset: rng.int(textLength(editor, focus) + 1),
						},
					});
				} else {
					const start = rng.int(ids.length);
					editor.selectBlocks(ids.slice(start, start + 1 + rng.int(4)));
				}
				return;
			}
			default: {
				const unhandled: never = op;
				return unhandled;
			}
		}
	};

	const checkPeer = (peer: PeerState): string[] => {
		const { editor } = peer;
		const after = storedBlockStates(editor);
		const problems = [
			...checkDocumentIndex(editor),
			...checkBlockIndex(editor, internals),
			...checkTouchedIds(peer.before, after, peer.summaries),
			...checkNotifier(
				editor,
				peer.notifier,
				new Set(peer.segmentSubscriptions.keys()),
				internals,
			),
			...peer.churn.missedNotifications(),
			...checkNotifier(
				editor,
				peer.churn.notifier,
				new Set(peer.churn.parents),
				internals,
				{
					label: "C churn",
					subscribedBlocks: new Set(peer.churn.blocks),
					detaches: true,
				},
			),
			...checkDecorations(editor),
			...checkSuggestions(editor),
			...checkSearch(editor),
			...checkPassIndex(editor),
		];
		return problems.map((problem) => `peer ${peer.label}: ${problem}`);
	};

	return {
		editor: peers[0]!.editor,
		editors: peers.map((peer) => peer.editor),
		trace: () => trace.join("\n"),
		step() {
			for (const peer of peers) {
				peer.before = storedBlockStates(peer.editor);
				peer.summaries.length = 0;
			}
			const op = rng.pick(pool);
			for (const peer of peers) trace.push(`${peer.label} ${peer.churn.render()}`);
			runOp(op);
			for (const peer of peers) {
				remount(peer);
				trace.push(`${peer.label} ${peer.churn.effects()}`);
			}
			return op;
		},
		check() {
			return peers.flatMap(checkPeer);
		},
		destroy() {
			for (const peer of peers) {
				peer.stream?.abort();
				peer.offCommit();
				peer.offDocument();
				for (const unsubscribe of peer.blockSubscriptions.values())
					unsubscribe();
				for (const unsubscribe of peer.segmentSubscriptions.values())
					unsubscribe();
				peer.notifier.destroy();
				peer.churn.destroy();
			}
			harness.destroy();
		},
	};
}
