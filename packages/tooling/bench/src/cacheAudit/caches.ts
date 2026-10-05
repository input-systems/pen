import { getAIController } from "@input/pen-ai";
import { getSearchController } from "@input/pen-search";
import type { ChangeSummary, Editor, PenDocument } from "@input/pen-types";
import type { AuditEditor } from "./fixture";
import type { AuditInternals } from "./internals";

/**
 * Bench-only switches that run one incremental cache's consumer path either
 * as shipped or as the naive full recompute the simplification plan names
 * (Phase 1, caches A–G). Each switch patches one live instance's methods; no
 * production module changes. The component clock accumulates the time spent
 * in the patched consumer, in both modes.
 */
export type AuditMode = "incremental" | "naive";

export type CacheId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export interface CacheSwitch {
	setMode(mode: AuditMode): void;
	/** Milliseconds spent in the cache's consumer since the last take. */
	takeComponentMs(): number;
	dispose(): void;
}

type AnyFn = (...args: never[]) => unknown;
type Patchable = Record<string, unknown>;

/** Shadows `key` with an own property; dispose restores what was there. */
function patchMethod<T extends AnyFn>(target: object, key: string, make: (original: T) => T): () => void {
	const record = target as Patchable;
	const hadOwn = Object.prototype.hasOwnProperty.call(record, key);
	const previous = record[key];
	const original = (previous as T).bind(target) as T;
	record[key] = make(original);
	return () => {
		if (hadOwn) record[key] = previous;
		else delete record[key];
	};
}

class Clock {
	private total = 0;
	time<R>(run: () => R): R {
		const start = performance.now();
		try {
			return run();
		} finally {
			this.total += performance.now() - start;
		}
	}
	add(ms: number): void {
		this.total += ms;
	}
	take(): number {
		const total = this.total;
		this.total = 0;
		return total;
	}
}

function makeSwitch(clock: Clock, restores: readonly (() => void)[], state: { mode: AuditMode }): CacheSwitch {
	return {
		setMode(mode) {
			state.mode = mode;
		},
		takeComponentMs: () => clock.take(),
		dispose() {
			for (const restore of [...restores].reverse()) restore();
		},
	};
}

function internalsOf<T>(editor: Editor, key: string): T {
	return (editor as unknown as Record<string, T>)[key] as T;
}

/** A: naive calls `documentState.rebuild()` on every commit. */
function documentIndexSwitch(editor: Editor): CacheSwitch {
	const clock = new Clock();
	const state = { mode: "incremental" as AuditMode };
	const documentState = editor.documentState as unknown as {
		incrementalUpdate(ids: readonly string[]): void;
		rebuild(): void;
	};
	const restore = patchMethod<(ids: readonly string[]) => void>(documentState, "incrementalUpdate", (original) => (ids) =>
		clock.time(() => (state.mode === "naive" ? documentState.rebuild() : original(ids))),
	);
	return makeSwitch(clock, [restore], state);
}

interface BlockIndexLike {
	applyTextLengths(blockText: unknown): void;
	applyStructure(readBlock: unknown, delta: unknown, named: unknown): boolean;
	replace(snapshot: unknown): void;
}

/**
 * B: naive rebuilds the change-summary block index from the document, text
 * lengths included, on every commit. Incremental advances lengths in place on
 * a text commit and advances the arrays and maps a structural commit names
 * (`applyStructure`), replacing the index from the document only when it
 * refuses (COL4). The clock covers those three methods in both modes.
 */
function blockIndexSwitch(editor: Editor, internals: AuditInternals): CacheSwitch {
	const clock = new Clock();
	const state = { mode: "incremental" as AuditMode };
	const index = internalsOf<BlockIndexLike>(editor, "_blockIndex");
	const doc = editor.internals.doc as PenDocument;
	const replaceOriginal = index.replace.bind(index);
	const fullRebuild = () => replaceOriginal(internals.createBlockIndexSnapshotFromDocument(doc));
	const restores = [
		patchMethod<(blockText: unknown) => void>(index, "applyTextLengths", (original) => (blockText) =>
			clock.time(() => (state.mode === "naive" ? fullRebuild() : original(blockText))),
		),
		patchMethod<(target: unknown, delta: unknown, named: unknown) => boolean>(
			index,
			"applyStructure",
			(original) => (target, delta, named) =>
				clock.time(() => {
					if (state.mode === "incremental") return original(target, delta, named);
					fullRebuild();
					return true;
				}),
		),
		patchMethod<(snapshot: unknown) => void>(index, "replace", (original) => (snapshot) =>
			clock.time(() => original(snapshot)),
		),
	];
	return makeSwitch(clock, restores, state);
}

interface NotifierInternals {
	_onCommit(event: unknown): void;
	_onSelection(): void;
	_listTouchedParents(
		summary: ChangeSummary,
		previousRootIds: readonly string[] | null,
		movedLists: readonly string[],
	): Map<string | null, Set<string>>;
	_siblingsOf(parentId: string | null): readonly string[];
	_walkRun(siblings: readonly string[], index: number, context: unknown): readonly string[];
	_buildSegments(parentId: string | null): readonly unknown[];
	_storeSegments(parentId: string | null, segments: readonly unknown[], basis: readonly string[]): void;
	_notifyAll(subscribers: ReadonlySet<() => void>): void;
	readonly _segmentSubscribers: Map<string | null, Set<() => void>>;
	readonly _knownLists: Map<string, readonly string[]>;
	readonly _editor: Editor;
}

/**
 * C: naive recomputes each touched sibling list whole from core on every
 * structural commit — list semantics over every run of the list
 * (`getListItemSemantics` per run, as the notifier's run walk does) and the
 * list's segments from `getListSegments` — instead of walking the runs around
 * the changed range and patching the previous segments. The clock covers the
 * notifier's whole commit and selection handlers.
 */
function notifierSwitch(audit: AuditEditor): CacheSwitch {
	const clock = new Clock();
	const state = { mode: "incremental" as AuditMode };
	const notifier = audit.notifier as unknown as NotifierInternals;
	const restores = [
		patchMethod<(event: unknown) => void>(notifier, "_onCommit", (original) => (event) =>
			clock.time(() => original(event)),
		),
		patchMethod<() => void>(notifier, "_onSelection", (original) => () => clock.time(original)),
		patchMethod<
			(
				summary: ChangeSummary,
				previousRootIds: readonly string[] | null,
				movedLists: readonly string[],
				ids: Set<string>,
				context: unknown,
			) => ReadonlyMap<string | null, unknown>
		>(
			notifier,
			"_collectListSemantics",
			(original) => (summary, previousRootIds, movedLists, ids, context) => {
				if (state.mode === "incremental") return original(summary, previousRootIds, movedLists, ids, context);
				const touched = notifier._listTouchedParents(summary, previousRootIds, movedLists);
				for (const parentId of touched.keys()) {
					const siblings = notifier._siblingsOf(parentId);
					for (let index = 0; index < siblings.length; index += 1) {
						for (const runId of notifier._walkRun(siblings, index, context)) ids.add(runId);
					}
				}
				// The baseline the next commit's moved lists are found against.
				for (const parentId of touched.keys()) {
					if (parentId !== null) {
						notifier._knownLists.set(parentId, notifier._editor.documentState.childrenOf(parentId));
					}
				}
				return new Map([...touched.keys()].map((parentId) => [parentId, null]));
			},
		),
		patchMethod<(parents: ReadonlyMap<string | null, unknown>, context: unknown) => void>(
			notifier,
			"_refreshSegments",
			(original) => (parents, context) => {
				if (state.mode === "incremental") {
					original(parents, context);
					return;
				}
				for (const parentId of parents.keys()) {
					const subscribers = notifier._segmentSubscribers.get(parentId);
					if (!subscribers) continue;
					// Recorded with its sibling list, as the notifier stores one,
					// so the next incremental commit patches it rather than
					// re-reading it whole.
					notifier._storeSegments(parentId, notifier._buildSegments(parentId), notifier._siblingsOf(parentId));
					notifier._notifyAll(subscribers);
				}
			},
		),
	];
	return makeSwitch(clock, restores, state);
}

interface DecorationCollectorLike {
	refresh(trigger: { readonly kind: string }): unknown;
}

/** D: naive recomputes every decoration source over every block on each commit. */
function decorationSwitch(editor: Editor): CacheSwitch {
	const clock = new Clock();
	const state = { mode: "incremental" as AuditMode };
	const collector = internalsOf<DecorationCollectorLike>(editor, "_decorationCollector");
	const restore = patchMethod<(trigger: { readonly kind: string }) => unknown>(collector, "refresh", (original) => (trigger) =>
		clock.time(() => original(state.mode === "naive" && trigger.kind === "commit" ? { kind: "full" } : trigger)),
	);
	return makeSwitch(clock, [restore], state);
}

interface SuggestionListLike {
	refreshForSummaries(editor: Editor, summaries: readonly ChangeSummary[]): void;
	refreshAll(editor: Editor): void;
	list(editor: Editor): unknown[];
}

/** E: naive re-reads every block's suggestions (`readAllSuggestions`'s walk) per commit. */
function suggestionSwitch(editor: Editor): CacheSwitch {
	const clock = new Clock();
	const state = { mode: "incremental" as AuditMode };
	const controller = getAIController(editor) as unknown as { _suggestionList: SuggestionListLike } | null;
	if (!controller) throw new Error("cache audit: the AI controller is not active");
	const list = controller._suggestionList;
	const restores = [
		patchMethod<(target: Editor, summaries: readonly ChangeSummary[]) => void>(list, "refreshForSummaries", (original) => (target, summaries) =>
			clock.time(() => (state.mode === "naive" ? list.refreshAll(target) : original(target, summaries))),
		),
		patchMethod<(target: Editor) => unknown[]>(list, "list", (original) => (target) => clock.time(() => original(target))),
	];
	return makeSwitch(clock, restores, state);
}

interface SearchControllerLike {
	recomputeForCommit(summary: ChangeSummary): void;
	recompute(): void;
	getState(): { readonly query: string };
}

/** F: naive rescans the whole document for the active query on every commit. */
function searchSwitch(editor: Editor): CacheSwitch {
	const clock = new Clock();
	const state = { mode: "incremental" as AuditMode };
	const controller = getSearchController(editor) as unknown as SearchControllerLike | null;
	if (!controller) throw new Error("cache audit: the search controller is not active");
	const restore = patchMethod<(summary: ChangeSummary) => void>(controller, "recomputeForCommit", (original) => (summary) =>
		clock.time(() => {
			if (state.mode === "incremental") original(summary);
			else if (controller.getState().query) controller.recompute();
		}),
	);
	return makeSwitch(clock, [restore], state);
}

/**
 * G: naive drops the normalization pass index before every pass, so each
 * commit's structural rules rebuild it from the whole document (liveness,
 * order and parent maps) instead of reusing it until the structure changes.
 */
function normalizeSwitch(editor: Editor): CacheSwitch {
	const clock = new Clock();
	const state = { mode: "incremental" as AuditMode };
	const engine = editor.internals.engine as unknown as { normalizeDirty(): void; passIndex: unknown };
	const restore = patchMethod<() => void>(engine, "normalizeDirty", (original) => () =>
		clock.time(() => {
			if (state.mode === "naive") engine.passIndex = null;
			original();
		}),
	);
	return makeSwitch(clock, [restore], state);
}

/** The switch for caches A–G; H is measured on the overlay contributor directly. */
export function installCacheSwitch(
	cache: Exclude<CacheId, "H">,
	audit: AuditEditor,
	internals: AuditInternals,
): CacheSwitch {
	switch (cache) {
		case "A":
			return documentIndexSwitch(audit.editor);
		case "B":
			return blockIndexSwitch(audit.editor, internals);
		case "C":
			return notifierSwitch(audit);
		case "D":
			return decorationSwitch(audit.editor);
		case "E":
			return suggestionSwitch(audit.editor);
		case "F":
			return searchSwitch(audit.editor);
		case "G":
			return normalizeSwitch(audit.editor);
		default: {
			const unhandled: never = cache;
			return unhandled;
		}
	}
}

