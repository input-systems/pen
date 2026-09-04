import type {
	BlockTextChange,
	CommitEvent,
	Decoration,
	DecorationSet,
	Editor,
	Extension,
	StructuralChange,
} from "@input/pen-types";
import {
	createDecorationSet,
	decorationsFacet,
	defineExtension,
	emptyDecorationSet,
	smoothStreamControllerFacet,
} from "@input/pen-core";

/** Slot mapped onto {@link smoothStreamControllerFacet} in `@input/pen-core`. */
const SMOOTH_STREAM_CONTROLLER_SLOT = "smooth-stream:controller";

/** Extension name under which paced stream paint registers. */
export const SMOOTH_STREAM_EXTENSION_NAME = "ai-smooth-stream";

const WORD_BOUNDARY_PATTERN = /\s/u;

const DEFAULT_INTERVAL_MS = 20;
const DEFAULT_DRAIN_MS = 1000;

/** Options for {@link smoothStreamExtension}. Every field is optional. */
export interface SmoothStreamOptions {
	/** Gap between reveal ticks in ms. Default 20. */
	intervalMs?: number;
	/** Unit released per tick. Default "word". */
	granularity?: "word" | "character";
	/**
	 * Catch-up time constant in ms. Each tick releases
	 * `max(1, ceil(hiddenCharCount * intervalMs / drainMs))` characters worth of
	 * units, so the backlog decays rather than clearing on a deadline: a burst
	 * catches up quickly and the tail settles back to one unit per tick.
	 * Default 1000, which lands a long burst around reading speed.
	 */
	drainMs?: number;
	/** When false nothing is withheld and pending text flushes. Default true. */
	enabled?: boolean;
	/**
	 * Decides whether a commit's inserted text should be paced.
	 * Default: `event.source === "stream"` — ST6's contract for streaming
	 * writes. AI-origin applies (Tab-accepted completions, suggestion splices)
	 * paint immediately unless a host passes a wider predicate.
	 */
	shouldPace?: (event: CommitEvent) => boolean;
}

/** Snapshot of whether streamed text is still withheld from paint. */
export interface SmoothStreamStatus {
	readonly isRevealing: boolean;
	readonly hiddenCharCount: number;
	readonly enabled: boolean;
}

/** Host control over paced paint of streamed text. */
export interface SmoothStreamController {
	/** Withholds `blockId` from `from` to its end, including text appended later. */
	hide(blockId: string, from: number): void;
	/** Releases up to `charBudget` characters worth of units. False when nothing is withheld. */
	revealNext(charBudget?: number): boolean;
	/** Reveals everything still withheld and stops the ticker. */
	flush(): void;
	hasHiddenText(): boolean;
	hiddenCharCount(): number;
	isRevealing(): boolean;
	setEnabled(enabled: boolean): void;
	isEnabled(): boolean;
	subscribe(listener: (status: SmoothStreamStatus) => void): () => void;
}

function defaultShouldPace(event: CommitEvent): boolean {
	return event.source === "stream";
}

/** Commits that end pacing outright rather than feeding it: typing and history moves. */
function interruptsPacing(event: CommitEvent): boolean {
	return (
		event.origin.type === "user" ||
		event.source === "undo" ||
		event.source === "redo"
	);
}

/** End of the unit starting at `from`, boundary whitespace included. */
function getNextWordEnd(text: string, from: number): number {
	const match = WORD_BOUNDARY_PATTERN.exec(text.slice(from));
	return match === null ? text.length : from + match.index + match[0].length;
}

function insertionEndsAtBlockEnd(
	editor: Editor,
	blockId: string,
	splice: { from: number; insertLength: number },
): boolean {
	const length = editor.getBlock(blockId)?.length() ?? 0;
	return splice.from + splice.insertLength === length;
}

function collectSmoothStreamDecorations(
	editor: Editor,
	hiddenFrom: Map<string, number>,
): DecorationSet {
	if (hiddenFrom.size === 0) {
		return emptyDecorationSet();
	}

	const decorations: Decoration[] = [];

	for (const [blockId, from] of hiddenFrom) {
		const length = editor.getBlock(blockId)?.length() ?? 0;
		if (from >= length) {
			continue;
		}

		decorations.push({
			type: "inline",
			blockId,
			from,
			to: length,
			attributes: {},
			omitFromRender: true,
			key: `${SMOOTH_STREAM_EXTENSION_NAME}:${blockId}`,
		});
	}

	return decorations.length === 0
		? emptyDecorationSet()
		: createDecorationSet(decorations);
}

class SmoothStreamControllerImpl implements SmoothStreamController {
	private readonly hiddenFrom = new Map<string, number>();
	private readonly listeners = new Set<
		(status: SmoothStreamStatus) => void
	>();
	private readonly intervalMs: number;
	private readonly drainMs: number;
	private readonly granularity: "word" | "character";
	private enabled: boolean;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly editor: Editor,
		options: SmoothStreamOptions,
	) {
		this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.drainMs = options.drainMs ?? DEFAULT_DRAIN_MS;
		this.granularity = options.granularity ?? "word";
		this.enabled = options.enabled ?? true;
	}

	hide(blockId: string, from: number): void {
		if (!this.enabled) {
			return;
		}

		const existing = this.hiddenFrom.get(blockId);
		// moving the frontier forward would paint withheld text early
		if (existing !== undefined && existing <= from) {
			return;
		}

		this.hiddenFrom.set(blockId, Math.max(0, from));
		this.editor.requestDecorationUpdate();
		this.startTicker();
		this.notify();
	}

	revealNext(charBudget = 1): boolean {
		let remaining = Math.max(1, charBudget);
		let released = false;

		while (remaining > 0) {
			const blockId = this.getFirstHiddenBlockId();
			if (blockId === undefined) {
				break;
			}

			const block = this.editor.getBlock(blockId);
			if (block == null) {
				this.hiddenFrom.delete(blockId);
				continue;
			}

			const from = this.hiddenFrom.get(blockId) ?? 0;
			const bound = block.length();
			const next = this.nextFrontier(
				block.textContent(),
				from,
				bound,
				remaining,
			);
			const advanced = next - from;
			if (advanced <= 0) {
				this.hiddenFrom.delete(blockId);
				continue;
			}

			if (next >= bound) {
				this.hiddenFrom.delete(blockId);
			} else {
				this.hiddenFrom.set(blockId, next);
			}

			remaining -= advanced;
			released = true;
		}

		if (released) {
			this.editor.requestDecorationUpdate();
			if (!this.hasHiddenText()) {
				this.stopTicker();
			}
			this.notify();
		} else {
			this.stopTicker();
		}

		return released;
	}

	flush(): void {
		const wasRevealing = this.timer !== undefined;
		this.stopTicker();
		if (this.hiddenFrom.size === 0 && !wasRevealing) {
			return;
		}

		this.hiddenFrom.clear();
		this.editor.requestDecorationUpdate();
		this.notify();
	}

	hasHiddenText(): boolean {
		return this.getFirstHiddenBlockId() !== undefined;
	}

	hiddenCharCount(): number {
		let count = 0;
		for (const [blockId, from] of this.hiddenFrom) {
			const length = this.editor.getBlock(blockId)?.length() ?? 0;
			if (from >= length) {
				this.hiddenFrom.delete(blockId);
				continue;
			}
			count += length - from;
		}
		return count;
	}

	isRevealing(): boolean {
		return this.timer !== undefined;
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) {
			return;
		}

		this.enabled = enabled;
		if (!enabled) {
			this.flush();
		}
		this.notify();
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	subscribe(listener: (status: SmoothStreamStatus) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	handleCommit(
		event: CommitEvent,
		shouldPace: (event: CommitEvent) => boolean,
	): void {
		if (interruptsPacing(event)) {
			this.flush();
			return;
		}

		if (!this.enabled || !shouldPace(event)) {
			return;
		}

		for (const change of event.summary.structural) {
			this.hideInsertedBlock(change);
		}

		for (const textChange of event.summary.blockText) {
			this.hideAppendedText(textChange);
		}
	}

	collectDecorations(): DecorationSet {
		return collectSmoothStreamDecorations(this.editor, this.hiddenFrom);
	}

	destroy(): void {
		this.flush();
		this.listeners.clear();
	}

	private hideAppendedText(textChange: BlockTextChange): void {
		for (const splice of textChange.splices) {
			if (splice.insertLength === 0) {
				continue;
			}
			// hide-to-end is only exact when the insertion itself is the new tail
			if (
				!insertionEndsAtBlockEnd(
					this.editor,
					textChange.blockId,
					splice,
				)
			) {
				continue;
			}
			this.hide(textChange.blockId, splice.from);
		}
	}

	// cyclomatic 10 here is the arity of the StructuralChange union, not branching
	// depth (cognitive 1); the exhaustive switch is what turns a new variant into
	// a compile error.
	private hideInsertedBlock(change: StructuralChange): void {
		switch (change.type) {
			case "block-inserted":
				this.hide(change.blockId, 0);
				return;
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
				const _exhaustive: never = change;
				return _exhaustive;
			}
		}
	}

	private nextFrontier(
		text: string,
		from: number,
		bound: number,
		charBudget: number,
	): number {
		switch (this.granularity) {
			case "word":
				return Math.min(getNextWordEnd(text, from), bound);
			case "character":
				return Math.min(from + charBudget, bound);
			default: {
				const _exhaustive: never = this.granularity;
				return _exhaustive;
			}
		}
	}

	private getFirstHiddenBlockId(): string | undefined {
		for (const block of this.editor.documentState.allBlocks()) {
			const from = this.hiddenFrom.get(block.id);
			if (from === undefined) {
				continue;
			}
			if (from < block.length()) {
				return block.id;
			}
			this.hiddenFrom.delete(block.id);
		}

		return undefined;
	}

	private tickBudget(): number {
		return Math.max(
			1,
			Math.ceil(
				(this.hiddenCharCount() * this.intervalMs) / this.drainMs,
			),
		);
	}

	private startTicker(): void {
		if (this.timer !== undefined || !this.hasHiddenText()) {
			return;
		}

		this.timer = setInterval(() => {
			if (!this.revealNext(this.tickBudget())) {
				this.stopTicker();
			}
		}, this.intervalMs);
		this.notify();
	}

	private stopTicker(): void {
		if (this.timer === undefined) {
			return;
		}

		clearInterval(this.timer);
		this.timer = undefined;
	}

	private notify(): void {
		if (this.listeners.size === 0) {
			return;
		}

		const status: SmoothStreamStatus = {
			isRevealing: this.isRevealing(),
			hiddenCharCount: this.hiddenCharCount(),
			enabled: this.isEnabled(),
		};
		for (const listener of this.listeners) {
			listener(status);
		}
	}
}

/**
 * Paces the paint of streamed text without buffering the document.
 *
 * Appends land in the document immediately — undo, export, and collaboration
 * stay complete — while `omitFromRender` holds back everything past a per-block
 * frontier that a library-owned ticker advances. `flush()` is therefore instant:
 * the text is already there.
 */
export function smoothStreamExtension(
	options: SmoothStreamOptions = {},
): Extension {
	const shouldPace = options.shouldPace ?? defaultShouldPace;
	let editor: Editor | null = null;
	let controller: SmoothStreamControllerImpl | null = null;
	let unsubscribeCommit: (() => void) | null = null;

	return defineExtension({
		name: SMOOTH_STREAM_EXTENSION_NAME,
		facets: [
			decorationsFacet.of((_documentState, _activeEditor) => {
				return controller?.collectDecorations() ?? emptyDecorationSet();
			}),
		],
		activateClient: async ({ editor: activeEditor }) => {
			editor = activeEditor;
			controller = new SmoothStreamControllerImpl(activeEditor, options);
			activeEditor.internals.assignSlot(
				SMOOTH_STREAM_CONTROLLER_SLOT,
				controller,
			);

			unsubscribeCommit = activeEditor.on(
				"commit",
				(event: CommitEvent) => {
					controller?.handleCommit(event, shouldPace);
				},
			);
		},
		deactivateClient: async () => {
			unsubscribeCommit?.();
			unsubscribeCommit = null;
			controller?.destroy();
			editor?.internals.assignSlot(SMOOTH_STREAM_CONTROLLER_SLOT, null);
			controller = null;
			editor = null;
		},
	});
}

/**
 * Returns the smooth-stream controller, or `null` when the extension is not installed.
 */
export function getSmoothStreamController(
	editor: Editor,
): SmoothStreamController | null {
	return (
		(editor.facet(
			smoothStreamControllerFacet,
		) as SmoothStreamController | null) ?? null
	);
}
