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
	UndoManager,
	Unsubscribe,
} from "@input/pen-types";
import { toolsExtension } from "@input/pen-tools";
import { undoExtension } from "@input/pen-undo";
import { isDeepStrictEqual } from "node:util";
import type { AuditBlockNotifier, AuditInternals } from "./internals";

/**
 * Seeded randomized equivalence for the kept caches A–G (simplification plan
 * Phase 2): after every random operation, each incremental cache must equal
 * the naive full recompute it replaces. One peer carries the realistic stack,
 * a block notifier subscribed like a renderer without virtualization, and a
 * second notifier whose subscriptions churn (`createChurnMount`); a second,
 * bare peer makes the remote commits.
 */

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
	"unparent",
	"delete-block",
	"indent",
	"type-change",
	"format",
	"undo",
	"redo",
	"remote",
	"sync-to-remote",
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
function storedBlockStates(editor: Editor): Map<string, string> {
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
				text: content?.toDelta?.() ?? null,
			}),
		);
	}
	return states;
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
function checkDocumentIndex(editor: Editor): string[] {
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
function checkBlockIndex(editor: Editor, internals: AuditInternals): string[] {
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
function checkTouchedIds(
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

/**
 * C: block list slices, child ids and sibling-list segments against a fresh,
 * detached notifier. A sibling list holding an id twice, an id another array
 * also lists, or an entry whose block a concurrent delete removed is skipped:
 * an undo or remote commit can leave each (COL4) until the next local pass
 * repairs it, a duplicate is unkeyable, a block has one list slice for two
 * lists, and only the attached notifier tracks which entries died. The
 * comparison resumes once the list is repaired. Root ids are compared live.
 * With `subscribedBlocks`, only those blocks are compared (a partial mount).
 */
function checkNotifier(
	editor: Editor,
	notifier: AuditBlockNotifier,
	subscribedParents: ReadonlySet<string | null>,
	internals: AuditInternals,
	label = "C",
	subscribedBlocks: ReadonlySet<string> | null = null,
): string[] {
	const fresh = internals.createBlockNotifier(editor);
	const problems: string[] = [];
	try {
		const document = (source: AuditBlockNotifier) =>
			(
				source as unknown as {
					getDocumentSnapshot(): {
						readonly rootIds: readonly string[];
					};
				}
			).getDocumentSnapshot();
		const live = (id: string) => editor.getBlock(id) !== null;
		const naiveDocument = {
			...document(fresh),
			rootIds: document(fresh).rootIds.filter(live),
		};
		const documentDifference = firstDifference(
			`${label} document snapshot`,
			document(notifier),
			naiveDocument,
		);
		if (documentDifference) problems.push(documentDifference);
		const siblings = (parentId: string | null) =>
			parentId === null
				? document(fresh).rootIds
				: editor.documentState.childrenOf(parentId);
		const multiListed = multiListedIds(editor);
		const keyable = (parentId: string | null) => {
			const list = siblings(parentId);
			return (
				new Set(list).size === list.length &&
				list.every((id) => live(id) && !multiListed.has(id))
			);
		};
		for (const parentId of subscribedParents) {
			if (!keyable(parentId)) continue;
			const difference = firstDifference(
				`${label} list segments of ${parentId ?? "root"}`,
				notifier.getListSegments(parentId),
				fresh.getListSegments(parentId),
			);
			if (difference) problems.push(difference);
		}
		for (const blockId of editor.documentState.preorderBlockIds()) {
			if (subscribedBlocks && !subscribedBlocks.has(blockId)) continue;
			const view = (source: AuditBlockNotifier) => {
				const read = notifierView(source, blockId) as Record<
					string,
					unknown
				>;
				return keyable(editor.documentState.parentOf(blockId)) &&
					!multiListed.has(blockId)
					? read
					: { ...read, list: "unrepaired sibling list" };
			};
			const difference = firstDifference(
				`${label} block snapshot ${blockId}`,
				view(notifier),
				view(fresh),
			);
			if (difference) problems.push(difference);
		}
	} finally {
		fresh.destroy();
	}
	return problems;
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
function checkSearch(editor: Editor): string[] {
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
function checkPassIndex(editor: Editor): string[] {
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
			const notes: string[] = [];
			const ids = new Set(live());
			for (const id of pendingBlocks) {
				if (ids.has(id) && !blockSubscriptions.has(id)) subscribeBlock(id);
			}
			for (const parentId of pendingParents) {
				if (parentId !== null && !ids.has(parentId)) continue;
				if (!segmentSubscriptions.has(parentId)) subscribeParent(parentId);
			}
			for (const id of [...blockSubscriptions.keys()]) {
				if (!ids.has(id) || rng.chance(CHURN_RELEASE))
					release(blockSubscriptions, id);
			}
			for (const parentId of [...segmentSubscriptions.keys()]) {
				if (
					(parentId !== null && !ids.has(parentId)) ||
					rng.chance(CHURN_RELEASE)
				)
					release(segmentSubscriptions, parentId);
			}
			if (released.length > 0 && rng.chance(CHURN_STALE)) {
				rng.pick(released)();
				notes.push("stale unsubscribe");
			}
			notes.push(
				`subscribed ${blockSubscriptions.size} blocks, segments ${JSON.stringify([...segmentSubscriptions.keys()])}`,
			);
			return `churn ${notes.join(", ")}`;
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
	readonly editor: TestEditor;
	/** Every write, delivery and history step so far, one per line. */
	trace(): string;
	/** Runs one random operation; returns its label. */
	step(): string;
	/** Every cache that differs from its naive recompute after the last step. */
	check(): string[];
	destroy(): void;
}

/** Builds one seeded case: the realistic peer, a bare remote peer and the subscribed notifier. */
export function createPropertyCase(
	seed: number,
	internals: AuditInternals,
): PropertyCase {
	const rng = createRng(seed);
	const harness: PeerHarness = createPeerHarness(2, {
		blocks: [...generateMixedBlockSpecs(ROOT_COUNT), ...calloutBlocks()],
		extensionsFor: (peer) =>
			peer === 0
				? [
						undoExtension(),
						deltaStreamExtension(),
						toolsExtension(),
						aiExtension({
							suggestMode: false,
							model: createModelDouble({ parts: [] }),
						}),
						searchExtension(),
					]
				: [],
	});
	const editor = harness.peer(0).editor;
	const remote = harness.peer(1).editor;
	// The test editor's `getBlock` throws for a missing block; the caches
	// read removed blocks and expect null, as the runtime returns.
	delete (editor as { getBlock?: unknown }).getBlock;
	delete (remote as { getBlock?: unknown }).getBlock;
	const search = getSearchController(editor);
	search?.setQuery(SEARCH_QUERY);
	search?.open();

	const notifier = internals.createBlockNotifier(editor);
	const noop = () => {};
	const blockSubscriptions = new Map<string, Unsubscribe>();
	const segmentSubscriptions = new Map<string | null, Unsubscribe>();
	const documentSubscription = notifier.subscribeDocument(noop);
	// Its own stream, so the operation walk is the same with or without it.
	const churn = createChurnMount(
		editor,
		internals.createBlockNotifier(editor),
		createRng(seed ^ 0x9e3779b9),
	);

	/** Mounts what a renderer would mount now: every block, and a segment list per sibling list. */
	const remount = () => {
		const state = editor.documentState;
		const live = new Set(state.preorderBlockIds());
		for (const [id, unsubscribe] of blockSubscriptions) {
			if (live.has(id)) continue;
			unsubscribe();
			blockSubscriptions.delete(id);
		}
		const parents = new Set<string | null>([null]);
		for (const id of live) {
			if (!blockSubscriptions.has(id))
				blockSubscriptions.set(id, notifier.subscribeBlock(id, noop));
			if (state.childrenOf(id).length > 0) parents.add(id);
		}
		for (const [parentId, unsubscribe] of segmentSubscriptions) {
			if (parents.has(parentId)) continue;
			unsubscribe();
			segmentSubscriptions.delete(parentId);
		}
		for (const parentId of parents) {
			if (segmentSubscriptions.has(parentId)) continue;
			segmentSubscriptions.set(
				parentId,
				notifier.subscribeListSegments(parentId, noop),
			);
			notifier.getListSegments(parentId);
		}
	};
	remount();

	const summaries: ChangeSummary[] = [];
	const offCommit = editor.on("commit", (event: CommitEvent) => {
		summaries.push(event.summary);
	});
	let before = storedBlockStates(editor);
	const trace: string[] = [];
	let serial = 0;
	const newId = (prefix: string) => `${prefix}-${seed}-${(serial += 1)}`;

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
	const containers = (target: Editor, type: string) =>
		liveIds(target).filter((id) => target.getBlock(id)?.type === type);

	const peerOf = (target: Editor) => (target === editor ? "local" : "remote");
	const apply = (
		target: Editor,
		ops: DocumentOp[],
		origin: Parameters<Editor["apply"]>[1] = { origin: "user" },
	) => {
		trace.push(`${peerOf(target)} ${JSON.stringify(ops)}`);
		try {
			target.apply(ops, origin);
		} catch {
			// An op the random walk built against a block another op changed;
			// rejection is the pipeline's business, not the caches'.
		}
	};

	/** One random local or remote write on `target`; the remote peer has no AI, search or undo. */
	const structuralWrite = (target: Editor, op: PropertyOp): void => {
		const texts = textIds(target);
		const all = liveIds(target);
		switch (op) {
			case "keystroke": {
				const blockId = rng.pick(texts);
				if (!blockId) return;
				const at = rng.int(textLength(target, blockId) + 1);
				const insert = rng.pick(TYPED);
				apply(target, [
					{ type: "splice-text", blockId, from: at, to: at, insert },
				]);
				if (target === editor)
					editor.selectText(
						blockId,
						at + insert.length,
						at + insert.length,
					);
				return;
			}
			case "delete-text": {
				const blockId = rng.pick(texts);
				if (!blockId) return;
				const length = textLength(target, blockId);
				const from = rng.int(length + 1);
				const to = Math.min(length, from + 1 + rng.int(4));
				apply(target, [
					{ type: "splice-text", blockId, from, to, insert: "" },
				]);
				return;
			}
			case "split": {
				const blockId = rng.pick(texts);
				if (!blockId) return;
				const offset = rng.int(textLength(target, blockId) + 1);
				const newBlockId = newId("split");
				trace.push(
					`${peerOf(target)} split ${blockId}@${offset} → ${newBlockId}`,
				);
				applySplitBlock(target, {
					blockId,
					offset,
					newBlockId,
					applyOptions: { origin: "user" },
				});
				return;
			}
			case "merge": {
				const sourceBlockId = rng.pick(texts);
				if (!sourceBlockId) return;
				const index = texts.indexOf(sourceBlockId);
				const targetBlockId = texts[index - 1];
				if (
					!targetBlockId ||
					isAncestor(target, sourceBlockId, targetBlockId)
				)
					return;
				trace.push(
					`${peerOf(target)} merge ${sourceBlockId} into ${targetBlockId}`,
				);
				try {
					applyMergeBlocks(target, {
						targetBlockId,
						sourceBlockId,
						applyOptions: { origin: "user" },
					});
				} catch {
					// See `apply`.
				}
				return;
			}
			case "insert-root": {
				const roots = rootIds(target);
				const position =
					roots.length === 0 || rng.chance(0.1)
						? rng.chance(0.5)
							? "first"
							: "last"
						: { after: rng.pick(roots) };
				apply(target, [
					{
						type: "insert-block",
						blockId: newId("root"),
						blockType: rng.pick(TEXT_TYPES),
						props: { indent: rng.int(2) },
						position,
					},
				]);
				return;
			}
			case "insert-children": {
				const parent = rng.pick(containers(target, "callout"));
				if (!parent) return;
				apply(target, [
					{
						type: "insert-block",
						blockId: newId("child"),
						blockType: rng.pick(LIST_TYPES),
						props: { indent: rng.int(2) },
						position: {
							parent,
							index: rng.int(
								target.documentState.childrenOf(parent).length +
									1,
							),
						},
					},
				]);
				return;
			}
			case "insert-parent-id": {
				const toggle = rng.pick(containers(target, "toggle"));
				if (!toggle) return;
				const siblings = target.documentState.childrenOf(toggle);
				const after =
					siblings.length > 0 && rng.chance(0.5)
						? rng.pick(siblings)
						: toggle;
				apply(target, [
					{
						type: "insert-block",
						blockId: newId("nested"),
						blockType: rng.pick(TEXT_TYPES),
						props: { parentId: toggle },
						position: { after },
					},
				]);
				return;
			}
			case "move-root": {
				const blockId = rng.pick(all);
				const roots = rootIds(target).filter(
					(id) => !isAncestor(target, blockId ?? "", id),
				);
				if (!blockId || roots.length === 0) return;
				const ops: DocumentOp[] = [
					{
						type: "move-block",
						blockId,
						position: { after: rng.pick(roots) },
					},
				];
				if (target.getBlock(blockId)?.props.parentId)
					ops.push({
						type: "set-props",
						blockId,
						props: { parentId: null },
					});
				apply(target, ops);
				return;
			}
			case "move-children": {
				const parent = rng.pick(containers(target, "callout"));
				const blockId = rng.pick(texts);
				if (!parent || !blockId || isAncestor(target, blockId, parent))
					return;
				const ops: DocumentOp[] = [
					{
						type: "move-block",
						blockId,
						position: {
							parent,
							index: rng.int(
								target.documentState.childrenOf(parent).length +
									1,
							),
						},
					},
				];
				if (target.getBlock(blockId)?.props.parentId)
					ops.push({
						type: "set-props",
						blockId,
						props: { parentId: null },
					});
				apply(target, ops);
				return;
			}
			case "move-parent-id": {
				const toggle = rng.pick(containers(target, "toggle"));
				const blockId = rng.pick(
					texts.filter((id) =>
						target.documentState.blockOrder.includes(id),
					),
				);
				if (!toggle || !blockId || isAncestor(target, blockId, toggle))
					return;
				apply(target, [
					{
						type: "move-block",
						blockId,
						position: { after: toggle },
					},
					{ type: "set-props", blockId, props: { parentId: toggle } },
				]);
				return;
			}
			case "unparent": {
				const blockId = rng.pick(
					all.filter((id) => {
						const parentId = target.getBlock(id)?.props.parentId;
						return typeof parentId === "string" && parentId !== "";
					}),
				);
				if (!blockId) return;
				apply(target, [
					{ type: "set-props", blockId, props: { parentId: null } },
				]);
				return;
			}
			case "delete-block": {
				const blockId = rng.pick(all);
				if (!blockId || all.length < 8) return;
				apply(target, [{ type: "delete-block", blockId }]);
				return;
			}
			case "indent": {
				const blockId = rng.pick(
					all.filter((id) =>
						(LIST_TYPES as readonly string[]).includes(
							target.getBlock(id)?.type ?? "",
						),
					),
				);
				if (!blockId) return;
				const indent = Number(
					target.getBlock(blockId)?.props.indent ?? 0,
				);
				const next = Math.max(
					0,
					Math.min(MAX_INDENT, indent + (rng.chance(0.5) ? 1 : -1)),
				);
				apply(target, [
					{ type: "set-props", blockId, props: { indent: next } },
				]);
				return;
			}
			case "type-change": {
				const blockId = rng.pick(texts);
				if (!blockId) return;
				apply(target, [
					{
						type: "set-props",
						blockId,
						props: { type: rng.pick(TEXT_TYPES) },
					},
				]);
				return;
			}
			case "format": {
				const blockId = rng.pick(texts);
				if (!blockId) return;
				const length = textLength(target, blockId);
				if (length === 0) return;
				const from = rng.int(length);
				apply(target, [
					{
						type: "format-text",
						blockId,
						from,
						to: Math.min(length, from + 3),
						marks: { bold: rng.chance(0.7) ? true : null },
					},
				]);
				return;
			}
			default:
				return;
		}
	};

	const REMOTE_OPS = [
		"keystroke",
		"delete-text",
		"split",
		"insert-root",
		"insert-children",
		"move-root",
		"move-children",
		"delete-block",
		"indent",
		"type-change",
	] as const;

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
			case "unparent":
			case "delete-block":
			case "indent":
			case "type-change":
			case "format":
				structuralWrite(editor, op);
				return;
			case "undo":
			case "redo": {
				const manager = editor.facet(
					undoManagerFacet,
				) as UndoManager | null;
				manager?.stopCapturing();
				trace.push(
					`local ${op} → ${String(op === "undo" ? manager?.undo() : manager?.redo())}`,
				);
				return;
			}
			case "remote": {
				// Half the time the remote peer acts on a stale document: a concurrent edit.
				if (rng.chance(0.5)) {
					trace.push("deliver local → remote");
					harness.deliver(0, 1);
				}
				structuralWrite(remote, rng.pick(REMOTE_OPS));
				trace.push("deliver remote → local");
				harness.deliver(1, 0);
				return;
			}
			case "concurrent-delete-move": {
				// COL4: a local delete against a remote move leaves a dead order
				// entry locally until the next local pass; an undo straight
				// after brings the block back without a pass in between.
				trace.push("deliver local → remote");
				harness.deliver(0, 1);
				const blockId = rng.pick(
					rootIds(editor).filter((id) => remote.getBlock(id) !== null),
				);
				const roots = rootIds(remote).filter((id) => id !== blockId);
				if (!blockId || roots.length === 0 || liveIds(editor).length < 8)
					return;
				apply(editor, [{ type: "delete-block", blockId }]);
				apply(remote, [
					{
						type: "move-block",
						blockId,
						position: { after: rng.pick(roots) },
					},
				]);
				trace.push("deliver remote → local");
				harness.deliver(1, 0);
				if (rng.chance(0.5)) {
					const manager = editor.facet(
						undoManagerFacet,
					) as UndoManager | null;
					manager?.stopCapturing();
					trace.push(`local undo → ${String(manager?.undo())}`);
				}
				return;
			}
			case "sync-to-remote":
				trace.push("deliver local → remote");
				harness.deliver(0, 1);
				return;
			case "ai-suggest": {
				const controller = getAIController(editor);
				const blockId = rng.pick(textIds(editor));
				if (!controller || !blockId) return;
				controller.setSuggestMode(true);
				try {
					const at = rng.int(textLength(editor, blockId) + 1);
					apply(
						editor,
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
				const controller = getAIController(editor);
				const suggestion = controller
					? rng.pick(controller.getSuggestions())
					: undefined;
				if (!controller || !suggestion) return;
				const accept = rng.chance(0.5);
				trace.push(
					`local ${accept ? "accept" : "reject"} suggestion in ${suggestion.blockId}`,
				);
				if (accept) controller.acceptSuggestion(suggestion.id);
				else controller.rejectSuggestion(suggestion.id);
				return;
			}
			case "select": {
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
					editor.selectBlocks(
						ids.slice(start, start + 1 + rng.int(4)),
					);
				}
				return;
			}
			default: {
				const unhandled: never = op;
				return unhandled;
			}
		}
	};

	return {
		editor,
		trace: () => trace.join("\n"),
		step() {
			before = storedBlockStates(editor);
			summaries.length = 0;
			const op = rng.pick(PROPERTY_OPS);
			trace.push(churn.render());
			runOp(op);
			remount();
			trace.push(churn.effects());
			return op;
		},
		check() {
			const after = storedBlockStates(editor);
			return [
				...checkDocumentIndex(editor),
				...checkBlockIndex(editor, internals),
				...checkTouchedIds(before, after, summaries),
				...checkNotifier(
					editor,
					notifier,
					new Set(segmentSubscriptions.keys()),
					internals,
				),
				...churn.missedNotifications(),
				...checkNotifier(
					editor,
					churn.notifier,
					new Set(churn.parents),
					internals,
					"C churn",
					new Set(churn.blocks),
				),
				...checkDecorations(editor),
				...checkSuggestions(editor),
				...checkSearch(editor),
				...checkPassIndex(editor),
			];
		},
		destroy() {
			offCommit();
			documentSubscription();
			for (const unsubscribe of blockSubscriptions.values())
				unsubscribe();
			for (const unsubscribe of segmentSubscriptions.values())
				unsubscribe();
			notifier.destroy();
			churn.destroy();
			harness.destroy();
		},
	};
}
