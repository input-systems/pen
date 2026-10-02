import type {
	BlockHandle,
	CommitEvent,
	Editor,
	ModelAdapter,
	Unsubscribe,
} from "@input/pen-types";

export type AISuggestionKind = "spelling" | "grammar" | "rephrase" | "clarity";

export interface AISuggestion {
	id: string;
	kind: AISuggestionKind;
	title: string;
	blockId: string;
	from: number;
	to: number;
	originalText: string;
	replacementText: string;
	reason?: string;
	confidence?: number;
	scopeId: string;
	scopeHash: string;
	createdAt: number;
	invalidated: boolean;
}

export interface AISuggestionCandidate {
	kind: AISuggestionKind;
	title: string;
	originalText: string;
	replacementText: string;
	reason?: string;
	confidence?: number;
}

/** one block's slice of a document scope; offsets index into `AISuggestionScope.text`. */
export interface AISuggestionScopeSegment {
	blockId: string;
	from: number;
	to: number;
}

export interface AISuggestionScope {
	id: string;
	blockId: string;
	blockType: string | null;
	text: string;
	from: number;
	to: number;
	hash: string;
	documentGeneration: number;
	/** set for document scopes: which block each part of `text` came from. */
	segments?: readonly AISuggestionScopeSegment[];
}

export interface AISuggestionGroup {
	id: string;
	blockId: string;
	suggestionIds: readonly string[];
	kind: AISuggestionKind | "mixed";
	title: string;
	from: number;
	to: number;
}

export interface AISuggestionsMetrics {
	requestCount: number;
	successCount: number;
	errorCount: number;
	cancelCount: number;
	cacheHitCount: number;
	dismissedRepeatDropCount: number;
	suggestionShownCount: number;
	suggestionAppliedCount: number;
	suggestionDismissedCount: number;
	promptTokens: number;
	completionTokens: number;
}

export interface AISuggestionsState {
	enabled: boolean;
	status: "idle" | "scheduled" | "requesting";
	activeRequestId: string | null;
	activeSuggestionId: string | null;
	activeSuggestionGroupId: string | null;
	suggestions: readonly AISuggestion[];
	groups: readonly AISuggestionGroup[];
	metrics: AISuggestionsMetrics;
}

export interface AISuggestionsBlockPolicy {
	allowedBlockTypes?: readonly string[];
	deniedBlockTypes?: readonly string[];
	/** host veto beyond block type, e.g. a paragraph nested inside a quoted region. */
	isBlockAllowed?: (block: BlockHandle) => boolean;
}

export interface AISuggestionsAnalyzerResult {
	candidates: readonly AISuggestionCandidate[];
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
	};
}

export interface AISuggestionsAnalyzer {
	analyze(input: {
		editor: Editor;
		scope: AISuggestionScope;
		contextBefore: string;
		contextAfter: string;
		signal?: AbortSignal;
	}): Promise<AISuggestionsAnalyzerResult>;
}

export type AISuggestionsMode = "cheap" | "balanced" | "aggressive";

export interface AISuggestionsExtensionConfig {
	mode?: AISuggestionsMode;
	model?: ModelAdapter;
	analyzer?: AISuggestionsAnalyzer;
	enabled?: boolean;
	debounceMs?: number;
	minChangedChars?: number;
	minStableMs?: number;
	cooldownMs?: number;
	maxScopeChars?: number;
	maxSuggestionsPerScope?: number;
	cacheTtlMs?: number;
	dismissMemoryMs?: number;
	minConfidence?: number;
	groupGapChars?: number;
	blockPolicy?: AISuggestionsBlockPolicy;
	/**
	 * sentence (default) clips to the edited sentence; block analyzes the whole dirty block;
	 * document analyzes every eligible block in one request and maps candidates back per block.
	 */
	scopeUnit?: "sentence" | "block" | "document";
}

export interface AISuggestionsController {
	getState(): AISuggestionsState;
	getSuggestionGroups(): readonly AISuggestionGroup[];
	subscribe(listener: () => void): Unsubscribe;
	getRuntimeSettings(): AISuggestionsExtensionConfig;
	updateRuntimeSettings(
		patch: Partial<
			Omit<
				AISuggestionsExtensionConfig,
				"model" | "analyzer" | "blockPolicy"
			>
		>,
	): AISuggestionsExtensionConfig;
	setEnabled(enabled: boolean): void;
	setActiveSuggestion(id: string | null): void;
	setActiveSuggestionGroup(id: string | null): void;
	request(options?: { force?: boolean; blockId?: string | null }): boolean;
	applySuggestion(id: string, groupId?: string): boolean;
	applySuggestionGroup(id: string): number;
	dismissSuggestion(id: string): boolean;
	dismissSuggestionGroup(id: string): number;
	dismissAllInBlock(blockId: string): number;
	clearInvalidSuggestions(): void;
	handleCommit(event: CommitEvent): void;
	destroy(): void;
}
