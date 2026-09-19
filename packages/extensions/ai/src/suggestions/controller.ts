import {
	fieldEditorHostFacet,
	getOpOriginType,
	localeFacet,
} from "@input/pen-core";
import { generateId } from "@input/pen-types";
import type {
	AnchorRange,
	CommitEvent,
	Editor,
	FieldEditor,
} from "@input/pen-types";
import { buildApplySuggestionOps } from "./apply";
import {
	buildSuggestionFingerprint,
	type CachedAnalysisResult,
	isCacheEntryFresh,
	isDismissFingerprintActive,
} from "./cache";
import {
	DEFAULT_CACHE_TTL_MS,
	DEFAULT_DISMISS_MEMORY_MS,
	DEFAULT_MAX_SUGGESTIONS_PER_SCOPE,
	DEFAULT_MIN_CONFIDENCE,
} from "./constants";
import { buildSuggestionGroups } from "./grouping";
import { materializeSuggestionsFromCandidates } from "./matcher";
import { analyzeSuggestionScope } from "./analyzer";
import { AISuggestionScheduler, type ReadyDirtyBlock } from "./scheduler";
import {
	buildDocumentSuggestionScope,
	buildSuggestionScope,
	type BuiltSuggestionScope,
} from "./scopeBuilder";
import {
	compareCandidatesForDisplay,
	rangesOverlap,
	resolvePreferredOffset,
	resolveSelectedBlockId,
} from "./controllerUtils";
import { mapSuggestionsThroughSummary } from "./controllerRangeMap";
import type {
	AISuggestion,
	AISuggestionCandidate,
	AISuggestionGroup,
	AISuggestionScope,
	AISuggestionsController,
	AISuggestionsExtensionConfig,
	AISuggestionsMetrics,
	AISuggestionsState,
} from "./types";

type StatePatch = Omit<Partial<AISuggestionsState>, "metrics"> & {
	metrics?: Partial<AISuggestionsMetrics>;
};

const INITIAL_METRICS: AISuggestionsMetrics = {
	requestCount: 0,
	successCount: 0,
	errorCount: 0,
	cancelCount: 0,
	cacheHitCount: 0,
	dismissedRepeatDropCount: 0,
	suggestionShownCount: 0,
	suggestionAppliedCount: 0,
	suggestionDismissedCount: 0,
	promptTokens: 0,
	completionTokens: 0,
};

export class AISuggestionsControllerImpl implements AISuggestionsController {
	private readonly editor: Editor;
	private readonly config: AISuggestionsExtensionConfig;
	private readonly listeners = new Set<() => void>();
	private readonly scheduler: AISuggestionScheduler;
	private readonly analysisCache = new Map<string, CachedAnalysisResult>();
	private readonly dismissedFingerprints = new Map<string, number>();
	private abortController: AbortController | null = null;
	private readonly ranges = new Map<string, AnchorRange>();
	private state: AISuggestionsState;

	constructor(editor: Editor, config: AISuggestionsExtensionConfig = {}) {
		this.editor = editor;
		this.config = config;
		this.state = {
			enabled: config.enabled ?? true,
			status: "idle",
			activeRequestId: null,
			activeSuggestionId: null,
			activeSuggestionGroupId: null,
			suggestions: [],
			groups: [],
			metrics: { ...INITIAL_METRICS },
		};
		this.scheduler = new AISuggestionScheduler(editor, config, {
			onScheduledChange: (scheduled) => {
				if (!this.state.enabled) {
					return;
				}
				this.setState({
					status: scheduled
						? "scheduled"
						: this.isRequesting()
							? "requesting"
							: "idle",
				});
			},
		});
	}

	getState(): AISuggestionsState {
		return this.state;
	}

	getSuggestionGroups(): readonly AISuggestionGroup[] {
		return this.state.groups;
	}

	getRuntimeSettings(): AISuggestionsExtensionConfig {
		return { ...this.config };
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	updateRuntimeSettings(
		patch: Partial<
			Omit<
				AISuggestionsExtensionConfig,
				"model" | "analyzer" | "blockPolicy"
			>
		>,
	): AISuggestionsExtensionConfig {
		Object.assign(this.config, patch);
		this.emit(false);
		return this.getRuntimeSettings();
	}

	setEnabled(enabled: boolean): void {
		if (this.state.enabled === enabled) {
			return;
		}

		if (!enabled) {
			const wasRequesting = this.isRequesting();
			this.abortController?.abort();
			this.abortController = null;
			this.scheduler.reset();
			this.replaceAllSuggestions([], {
				enabled: false,
				status: "idle",
				activeRequestId: null,
				activeSuggestionId: null,
				activeSuggestionGroupId: null,
				metrics: wasRequesting
					? {
							cancelCount: this.state.metrics.cancelCount + 1,
						}
					: undefined,
			});
			return;
		}

		this.setState({
			enabled: true,
			status: this.scheduler.hasDirtyBlocks()
				? "scheduled"
				: this.isRequesting()
					? "requesting"
					: "idle",
		});
	}

	setActiveSuggestion(id: string | null): void {
		if (this.state.activeSuggestionId === id) {
			return;
		}

		const activeGroupId =
			id == null
				? null
				: (this.state.groups.find((group) =>
						group.suggestionIds.includes(id),
					)?.id ?? null);

		this.setState({
			activeSuggestionId: id,
			activeSuggestionGroupId: activeGroupId,
		});
	}

	setActiveSuggestionGroup(id: string | null): void {
		if (this.state.activeSuggestionGroupId === id) {
			return;
		}

		const firstSuggestionId =
			id == null
				? null
				: (this.state.groups.find((group) => group.id === id)
						?.suggestionIds[0] ?? null);

		this.setState({
			activeSuggestionGroupId: id,
			activeSuggestionId: firstSuggestionId,
		});
	}

	request(options?: { force?: boolean; blockId?: string | null }): boolean {
		if (
			!this.state.enabled ||
			(!options?.force && !this.isEditorReadyForSuggestions())
		) {
			return false;
		}

		const ready = options?.force
			? this.resolveForcedDirtyBlock(options.blockId)
			: this.scheduler.consumeNextReadyBlock();
		if (!ready) {
			if (!this.isRequesting()) {
				this.setState({
					status: this.scheduler.hasDirtyBlocks()
						? "scheduled"
						: "idle",
				});
			}
			return false;
		}

		const isDocumentScope = this.config.scopeUnit === "document";
		if (isDocumentScope) {
			this.scheduler.clearDirtyBlocks();
		}
		const builtScope = isDocumentScope
			? buildDocumentSuggestionScope(this.editor, this.config)
			: buildSuggestionScope(this.editor, ready.state, this.config);
		if (!builtScope) {
			this.setState({
				status: this.scheduler.hasDirtyBlocks() ? "scheduled" : "idle",
			});
			return false;
		}

		this.pruneMemory();
		const cacheTtlMs = this.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		const cached = this.analysisCache.get(builtScope.scope.hash);
		if (cached && isCacheEntryFresh(cached, cacheTtlMs)) {
			const cachedCandidates = this.filterCandidatesForDisplay(
				builtScope.scope.hash,
				cached.candidates,
			);
			const suggestions = materializeSuggestionsFromCandidates({
				blockId: builtScope.scope.blockId,
				scopeId: builtScope.scope.id,
				scopeHash: builtScope.scope.hash,
				scopeText: builtScope.scope.text,
				scopeFrom: builtScope.scope.from,
				candidates: cachedCandidates,
				segments: builtScope.scope.segments,
			});

			this.replaceSuggestionsForScope(builtScope.scope, suggestions, {
				status: this.scheduler.hasDirtyBlocks() ? "scheduled" : "idle",
				activeSuggestionId: suggestions[0]?.id ?? null,
				metrics: {
					cacheHitCount: this.state.metrics.cacheHitCount + 1,
					suggestionShownCount:
						this.state.metrics.suggestionShownCount +
						suggestions.length,
				},
			});
			return true;
		}

		this.abortController?.abort();
		this.abortController = new AbortController();
		const requestId = generateId();

		this.setState({
			status: "requesting",
			activeRequestId: requestId,
			metrics: {
				...this.state.metrics,
				requestCount: this.state.metrics.requestCount + 1,
			},
		});

		void this.runAnalysis(
			requestId,
			builtScope,
			this.abortController.signal,
		);
		return true;
	}

	applySuggestion(id: string, groupId = generateId()): boolean {
		const suggestion = this.state.suggestions.find(
			(item) => item.id === id && !item.invalidated,
		);
		if (!suggestion) {
			return false;
		}

		const ops = buildApplySuggestionOps(this.editor, suggestion);
		if (ops.length === 0) {
			return false;
		}

		this.editor.apply(ops, {
			origin: { type: "ai", groupId },
			undoGroupId: groupId,
		});

		const nextSuggestions = this.state.suggestions.filter(
			(item) =>
				item.blockId !== suggestion.blockId ||
				!rangesOverlap(
					item.from,
					item.to,
					suggestion.from,
					suggestion.to,
				),
		);

		this.replaceAllSuggestions(nextSuggestions, {
			activeSuggestionId: null,
			activeSuggestionGroupId: null,
			metrics: {
				suggestionAppliedCount:
					this.state.metrics.suggestionAppliedCount + 1,
			},
		});
		return true;
	}

	applySuggestionGroup(id: string): number {
		const group = this.state.groups.find((item) => item.id === id);
		if (!group) {
			return 0;
		}

		const suggestions = group.suggestionIds
			.map(
				(suggestionId) =>
					this.state.suggestions.find(
						(item) => item.id === suggestionId,
					) ?? null,
			)
			.filter(Boolean)
			.sort((left, right) => (right?.from ?? 0) - (left?.from ?? 0));

		const groupId = generateId();
		let appliedCount = 0;
		for (const suggestion of suggestions) {
			if (suggestion && this.applySuggestion(suggestion.id, groupId)) {
				appliedCount += 1;
			}
		}
		return appliedCount;
	}

	dismissSuggestion(id: string): boolean {
		const suggestion = this.state.suggestions.find(
			(item) => item.id === id,
		);
		if (!suggestion) {
			return false;
		}

		this.dismissedFingerprints.set(
			buildSuggestionFingerprint(
				suggestion.scopeHash,
				{
					kind: suggestion.kind,
					originalText: suggestion.originalText,
					replacementText: suggestion.replacementText,
				},
				this.editor.facet(localeFacet),
			),
			Date.now(),
		);

		this.replaceAllSuggestions(
			this.state.suggestions.filter((item) => item.id !== id),
			{
				activeSuggestionId: null,
				activeSuggestionGroupId: null,
				metrics: {
					suggestionDismissedCount:
						this.state.metrics.suggestionDismissedCount + 1,
				},
			},
		);
		return true;
	}

	dismissSuggestionGroup(id: string): number {
		const group = this.state.groups.find((item) => item.id === id);
		if (!group) {
			return 0;
		}

		let dismissedCount = 0;
		for (const suggestionId of group.suggestionIds) {
			if (this.dismissSuggestion(suggestionId)) {
				dismissedCount += 1;
			}
		}
		return dismissedCount;
	}

	dismissAllInBlock(blockId: string): number {
		const removedCount = this.state.suggestions.filter(
			(suggestion) => suggestion.blockId === blockId,
		).length;
		if (removedCount === 0) {
			return 0;
		}

		this.replaceAllSuggestions(
			this.state.suggestions.filter(
				(suggestion) => suggestion.blockId !== blockId,
			),
			{
				activeSuggestionId: null,
				activeSuggestionGroupId: null,
				metrics: {
					suggestionDismissedCount:
						this.state.metrics.suggestionDismissedCount +
						removedCount,
				},
			},
		);
		return removedCount;
	}

	clearInvalidSuggestions(): void {
		const nextSuggestions = this.state.suggestions.filter(
			(suggestion) => !suggestion.invalidated,
		);
		if (nextSuggestions.length === this.state.suggestions.length) {
			return;
		}

		this.replaceAllSuggestions(nextSuggestions, {
			activeSuggestionId: nextSuggestions.some(
				(suggestion) => suggestion.id === this.state.activeSuggestionId,
			)
				? this.state.activeSuggestionId
				: null,
			activeSuggestionGroupId: nextSuggestions.some((suggestion) =>
				this.state.groups
					.find(
						(group) =>
							group.id === this.state.activeSuggestionGroupId,
					)
					?.suggestionIds.includes(suggestion.id),
			)
				? this.state.activeSuggestionGroupId
				: null,
		});
	}

	handleCommit(event: CommitEvent): void {
		const mapped = mapSuggestionsThroughSummary({
			editor: this.editor,
			ranges: this.ranges,
			suggestions: this.state.suggestions,
			activeSuggestionId: this.state.activeSuggestionId,
			activeSuggestionGroupId: this.state.activeSuggestionGroupId,
			summary: event.summary,
		});
		if (mapped) {
			this.replaceAllSuggestions(mapped.suggestions, {
				activeSuggestionId: mapped.activeSuggestionId,
				activeSuggestionGroupId: mapped.activeSuggestionGroupId,
			});
		}

		const originType = getOpOriginType(event.origin);
		if (originType !== "user" && originType !== "input-rule") {
			return;
		}

		this.scheduler.markDirty(event, () => {
			void Promise.resolve().then(() => {
				this.request();
			});
		});
	}

	destroy(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.scheduler.destroy();
		this.analysisCache.clear();
		this.dismissedFingerprints.clear();
		this.ranges.clear();
		this.listeners.clear();
	}

	private async runAnalysis(
		requestId: string,
		builtScope: BuiltSuggestionScope,
		signal: AbortSignal,
	): Promise<void> {
		try {
			const result = await analyzeSuggestionScope({
				editor: this.editor,
				scope: builtScope,
				config: this.config,
				signal,
			});

			if (signal.aborted || this.state.activeRequestId !== requestId) {
				if (!signal.aborted) {
					this.setState({
						metrics: {
							...this.state.metrics,
							cancelCount: this.state.metrics.cancelCount + 1,
						},
					});
				}
				return;
			}

			this.analysisCache.set(builtScope.scope.hash, {
				scopeHash: builtScope.scope.hash,
				candidates: result.candidates,
				createdAt: Date.now(),
			});

			const filteredCandidates = this.filterCandidatesForDisplay(
				builtScope.scope.hash,
				result.candidates,
			);
			const suggestions = materializeSuggestionsFromCandidates({
				blockId: builtScope.scope.blockId,
				scopeId: builtScope.scope.id,
				scopeHash: builtScope.scope.hash,
				scopeText: builtScope.scope.text,
				scopeFrom: builtScope.scope.from,
				candidates: filteredCandidates,
				segments: builtScope.scope.segments,
			});

			this.replaceSuggestionsForScope(builtScope.scope, suggestions, {
				status: this.scheduler.hasDirtyBlocks() ? "scheduled" : "idle",
				activeRequestId: null,
				activeSuggestionId: suggestions[0]?.id ?? null,
				activeSuggestionGroupId: null,
				metrics: {
					successCount: this.state.metrics.successCount + 1,
					suggestionShownCount:
						this.state.metrics.suggestionShownCount +
						suggestions.length,
					promptTokens:
						this.state.metrics.promptTokens +
						result.usage.promptTokens,
					completionTokens:
						this.state.metrics.completionTokens +
						result.usage.completionTokens,
				},
			});
		} catch (error) {
			if (!signal.aborted) {
				this.setState({
					status: this.scheduler.hasDirtyBlocks()
						? "scheduled"
						: "idle",
					activeRequestId: null,
					metrics: {
						...this.state.metrics,
						errorCount: this.state.metrics.errorCount + 1,
					},
				});
			}
		}
	}

	private filterCandidatesForDisplay(
		scopeHash: string,
		candidates: readonly AISuggestionCandidate[],
	): readonly AISuggestionCandidate[] {
		const minConfidence =
			this.config.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
		const dismissMemoryMs =
			this.config.dismissMemoryMs ?? DEFAULT_DISMISS_MEMORY_MS;

		const nextCandidates: AISuggestionCandidate[] = [];
		let dismissedRepeatDropCount = 0;

		for (const candidate of candidates) {
			if (
				typeof candidate.confidence === "number" &&
				candidate.confidence < minConfidence
			) {
				continue;
			}

			const fingerprint = buildSuggestionFingerprint(
				scopeHash,
				candidate,
				this.editor.facet(localeFacet),
			);
			const dismissedAt = this.dismissedFingerprints.get(fingerprint);
			if (
				typeof dismissedAt === "number" &&
				isDismissFingerprintActive(dismissedAt, dismissMemoryMs)
			) {
				dismissedRepeatDropCount += 1;
				continue;
			}

			nextCandidates.push(candidate);
		}

		nextCandidates.sort(compareCandidatesForDisplay);

		const maxSuggestionsPerScope =
			this.config.maxSuggestionsPerScope ??
			DEFAULT_MAX_SUGGESTIONS_PER_SCOPE;
		const limitedCandidates = nextCandidates.slice(
			0,
			maxSuggestionsPerScope,
		);

		if (dismissedRepeatDropCount > 0) {
			this.setState({
				metrics: {
					...this.state.metrics,
					dismissedRepeatDropCount:
						this.state.metrics.dismissedRepeatDropCount +
						dismissedRepeatDropCount,
				},
			});
		}

		return limitedCandidates;
	}

	// an analysis answers for one scope, so only suggestions that scope covers are stale;
	// earlier sentences in the same block keep their suggestions until an edit kills the range.
	// a document scope covers every segment block whole.
	private replaceSuggestionsForScope(
		scope: AISuggestionScope,
		nextSuggestions: readonly AISuggestion[],
		patch?: StatePatch,
	): void {
		const segmentBlockIds = scope.segments
			? new Set(scope.segments.map((segment) => segment.blockId))
			: null;
		const isCoveredByScope = (suggestion: AISuggestion): boolean =>
			segmentBlockIds
				? segmentBlockIds.has(suggestion.blockId)
				: suggestion.blockId === scope.blockId &&
					rangesOverlap(
						suggestion.from,
						suggestion.to,
						scope.from,
						scope.to,
					);

		this.replaceAllSuggestions(
			[
				...this.state.suggestions.filter(
					(suggestion) => !isCoveredByScope(suggestion),
				),
				...nextSuggestions,
			],
			patch,
		);
	}

	private replaceAllSuggestions(
		nextSuggestions: readonly AISuggestion[],
		patch?: StatePatch,
	): void {
		const kept = new Set(
			nextSuggestions.map((suggestion) => suggestion.id),
		);
		for (const id of this.ranges.keys()) {
			if (!kept.has(id)) {
				this.ranges.delete(id);
			}
		}
		for (const suggestion of nextSuggestions) {
			if (this.ranges.has(suggestion.id)) {
				continue;
			}
			const range = this.editor.anchors.range({
				anchor: {
					blockId: suggestion.blockId,
					offset: suggestion.from,
				},
				focus: {
					blockId: suggestion.blockId,
					offset: suggestion.to,
				},
			});
			if (range) {
				this.ranges.set(suggestion.id, range);
			}
		}
		const groups = buildSuggestionGroups(nextSuggestions, this.config);
		const hasActiveSuggestionPatch =
			patch != null &&
			Object.prototype.hasOwnProperty.call(patch, "activeSuggestionId");
		const hasActiveGroupPatch =
			patch != null &&
			Object.prototype.hasOwnProperty.call(
				patch,
				"activeSuggestionGroupId",
			);
		const nextActiveSuggestionId = hasActiveSuggestionPatch
			? (patch?.activeSuggestionId ?? null)
			: this.state.activeSuggestionId;
		const activeGroupId = hasActiveGroupPatch
			? (patch?.activeSuggestionGroupId ?? null)
			: (groups.find((group) =>
					nextActiveSuggestionId != null
						? group.suggestionIds.includes(nextActiveSuggestionId)
						: false,
				)?.id ?? null);

		this.setState({
			...patch,
			suggestions: nextSuggestions,
			groups,
			activeSuggestionId: nextActiveSuggestionId,
			activeSuggestionGroupId: activeGroupId,
		});
	}

	private setState(patch: StatePatch): void {
		const previousState = this.state;
		const nextState = {
			...this.state,
			...patch,
			metrics: patch.metrics
				? {
						...this.state.metrics,
						...patch.metrics,
					}
				: this.state.metrics,
		};
		this.state = nextState;
		this.emit(
			previousState.suggestions !== nextState.suggestions ||
				previousState.groups !== nextState.groups ||
				previousState.activeSuggestionId !==
					nextState.activeSuggestionId,
		);
	}

	private emit(shouldRefreshDecorations = true): void {
		if (shouldRefreshDecorations) {
			this.editor.requestDecorationUpdate();
		}
		for (const listener of this.listeners) {
			listener();
		}
	}

	private pruneMemory(): void {
		const cacheTtlMs = this.config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		const dismissMemoryMs =
			this.config.dismissMemoryMs ?? DEFAULT_DISMISS_MEMORY_MS;
		const now = Date.now();

		for (const [scopeHash, entry] of this.analysisCache) {
			if (!isCacheEntryFresh(entry, cacheTtlMs, now)) {
				this.analysisCache.delete(scopeHash);
			}
		}

		for (const [fingerprint, dismissedAt] of this.dismissedFingerprints) {
			if (
				!isDismissFingerprintActive(dismissedAt, dismissMemoryMs, now)
			) {
				this.dismissedFingerprints.delete(fingerprint);
			}
		}
	}

	private isEditorReadyForSuggestions(): boolean {
		const fieldEditor =
			(this.editor.facet(fieldEditorHostFacet) as FieldEditor | null) ??
			null;
		if (!fieldEditor) {
			return true;
		}
		return (
			fieldEditor.isFocused &&
			fieldEditor.isEditing &&
			!fieldEditor.isComposing
		);
	}

	private isRequesting(): boolean {
		return (
			this.state.activeRequestId != null &&
			this.state.status === "requesting"
		);
	}

	private resolveForcedDirtyBlock(
		blockId: string | null | undefined,
	): ReadyDirtyBlock | null {
		const targetBlockId =
			blockId ??
			resolveSelectedBlockId(this.editor) ??
			this.editor.firstBlock()?.id ??
			null;
		if (!targetBlockId) {
			return null;
		}

		const block = this.editor.getBlock(targetBlockId);
		if (!block) {
			return null;
		}

		const text = block.textContent({ resolved: true });
		return {
			blockId: targetBlockId,
			state: {
				blockId: targetBlockId,
				firstChangedAt: Date.now(),
				lastChangedAt: Date.now(),
				changeCount: 1,
				changedCharsEstimate: Math.max(1, text.trim().length),
				lastChangedOffset: resolvePreferredOffset(
					this.editor,
					targetBlockId,
					text.length,
				),
			},
		};
	}
}
