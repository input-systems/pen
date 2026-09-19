import { affectedBlockIdsFromSummary } from "@input/pen-core";
import type {
	BlockHandle,
	ChangeSummary,
	CommitEvent,
	Editor,
} from "@input/pen-types";
import {
	DEFAULT_ALLOWED_BLOCK_TYPES,
	DEFAULT_COOLDOWN_MS,
	DEFAULT_DEBOUNCE_MS,
	DEFAULT_MIN_CHANGED_CHARS,
	DEFAULT_MIN_STABLE_MS,
} from "./constants";
import type { AISuggestionsExtensionConfig } from "./types";

export interface DirtyBlockState {
	blockId: string;
	firstChangedAt: number;
	lastChangedAt: number;
	changeCount: number;
	changedCharsEstimate: number;
	lastChangedOffset: number | null;
}

export interface ReadyDirtyBlock {
	blockId: string;
	state: DirtyBlockState;
}

export class AISuggestionScheduler {
	private readonly editor: Editor;
	private readonly config: AISuggestionsExtensionConfig;
	private readonly dirtyBlocks = new Map<string, DirtyBlockState>();
	private readonly lastRequestedAtByBlock = new Map<string, number>();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private onScheduledChange?: (scheduled: boolean) => void;

	constructor(
		editor: Editor,
		config: AISuggestionsExtensionConfig = {},
		options?: { onScheduledChange?: (scheduled: boolean) => void },
	) {
		this.editor = editor;
		this.config = config;
		this.onScheduledChange = options?.onScheduledChange;
	}

	destroy(): void {
		this.reset();
	}

	reset(): void {
		this.clearTimer();
		this.dirtyBlocks.clear();
		this.lastRequestedAtByBlock.clear();
		this.onScheduledChange?.(false);
	}

	markDirty(event: CommitEvent, onDebouncedReady: () => void): void {
		const now = Date.now();

		for (const blockId of affectedBlockIdsFromSummary(event.summary)) {
			const block = this.editor.getBlock(blockId);
			if (!block || !isEligibleSuggestionBlock(block, this.config)) {
				continue;
			}

			const previous = this.dirtyBlocks.get(blockId);
			const changedCharsEstimate = estimateChangedCharsForBlock(
				event.summary,
				blockId,
			);
			const lastChangedOffset = resolveLastChangedOffset(
				event.summary,
				blockId,
			);

			this.dirtyBlocks.set(blockId, {
				blockId,
				firstChangedAt: previous?.firstChangedAt ?? now,
				lastChangedAt: now,
				changeCount: (previous?.changeCount ?? 0) + 1,
				changedCharsEstimate:
					(previous?.changedCharsEstimate ?? 0) +
					changedCharsEstimate,
				lastChangedOffset:
					lastChangedOffset ?? previous?.lastChangedOffset ?? null,
			});
		}

		if (this.dirtyBlocks.size === 0) {
			return;
		}

		this.schedule(onDebouncedReady);
	}

	consumeNextReadyBlock(): ReadyDirtyBlock | null {
		const now = Date.now();
		const minStableMs = this.config.minStableMs ?? DEFAULT_MIN_STABLE_MS;
		const minChangedChars =
			this.config.minChangedChars ?? DEFAULT_MIN_CHANGED_CHARS;
		const cooldownMs = this.config.cooldownMs ?? DEFAULT_COOLDOWN_MS;

		const candidates = [...this.dirtyBlocks.values()]
			.filter((state) => {
				if (now - state.lastChangedAt < minStableMs) {
					return false;
				}
				if (state.changedCharsEstimate < minChangedChars) {
					return false;
				}
				const lastRequestedAt =
					this.lastRequestedAtByBlock.get(state.blockId) ?? 0;
				return now - lastRequestedAt >= cooldownMs;
			})
			.sort((left, right) => left.lastChangedAt - right.lastChangedAt);

		const next = candidates[0];
		if (!next) {
			return null;
		}

		this.lastRequestedAtByBlock.set(next.blockId, now);
		this.dirtyBlocks.delete(next.blockId);
		if (this.dirtyBlocks.size === 0) {
			this.onScheduledChange?.(false);
		}

		return {
			blockId: next.blockId,
			state: next,
		};
	}

	hasDirtyBlocks(): boolean {
		return this.dirtyBlocks.size > 0;
	}

	// a document-scope request answers for every block, so the remaining dirty blocks are covered
	clearDirtyBlocks(): void {
		if (this.dirtyBlocks.size === 0) {
			return;
		}
		this.dirtyBlocks.clear();
		this.onScheduledChange?.(false);
	}

	private schedule(onDebouncedReady: () => void): void {
		this.clearTimer();
		this.onScheduledChange?.(true);
		const debounceMs = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.onScheduledChange?.(this.dirtyBlocks.size > 0);
			onDebouncedReady();
		}, debounceMs);
	}

	private clearTimer(): void {
		if (!this.debounceTimer) {
			return;
		}
		clearTimeout(this.debounceTimer);
		this.debounceTimer = null;
		this.onScheduledChange?.(this.dirtyBlocks.size > 0);
	}
}

export function isEligibleSuggestionBlock(
	block: BlockHandle,
	config: AISuggestionsExtensionConfig,
): boolean {
	const blockType = block.type;
	const allowed =
		config.blockPolicy?.allowedBlockTypes ?? DEFAULT_ALLOWED_BLOCK_TYPES;
	const denied = config.blockPolicy?.deniedBlockTypes ?? [];
	if (!blockType || denied.includes(blockType)) {
		return false;
	}
	if (!allowed.includes(blockType)) {
		return false;
	}
	return config.blockPolicy?.isBlockAllowed?.(block) ?? true;
}

function estimateChangedCharsForBlock(
	summary: ChangeSummary,
	blockId: string,
): number {
	const change = summary.blockText.find((item) => item.blockId === blockId);
	if (!change) {
		return summary.structural.some(
			(item) => "blockId" in item && item.blockId === blockId,
		)
			? 1
			: 0;
	}

	let changedChars = 0;
	for (const splice of change.splices) {
		changedChars += Math.max(splice.to - splice.from, splice.insertLength);
	}
	return changedChars;
}

function resolveLastChangedOffset(
	summary: ChangeSummary,
	blockId: string,
): number | null {
	const change = summary.blockText.find((item) => item.blockId === blockId);
	const last = change?.splices[change.splices.length - 1];
	return last?.from ?? null;
}
