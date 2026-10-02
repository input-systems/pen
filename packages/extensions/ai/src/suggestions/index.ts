export {
	aiSuggestionsExtension,
	AI_SUGGESTIONS_EXTENSION_NAME,
	getAISuggestionsController,
} from "./extension";
export {
	AI_SUGGESTIONS_SYSTEM_PROMPT,
	buildAISuggestionMessages,
} from "./promptBuilder";
export { parseSuggestionResponse } from "./analyzer";
export {
	AI_SUGGESTIONS_REQUEST_MODE,
	DEFAULT_ALLOWED_BLOCK_TYPES,
	DEFAULT_CACHE_TTL_MS,
	DEFAULT_COOLDOWN_MS,
	DEFAULT_DEBOUNCE_MS,
	DEFAULT_DISMISS_MEMORY_MS,
	DEFAULT_GROUP_GAP_CHARS,
	DEFAULT_MAX_SCOPE_CHARS,
	DEFAULT_MAX_SUGGESTIONS_PER_SCOPE,
	DEFAULT_MIN_CHANGED_CHARS,
	DEFAULT_MIN_CONFIDENCE,
	DEFAULT_MIN_STABLE_MS,
} from "./constants";
export type {
	AISuggestion,
	AISuggestionCandidate,
	AISuggestionGroup,
	AISuggestionKind,
	AISuggestionScope,
	AISuggestionScopeSegment,
	AISuggestionsAnalyzer,
	AISuggestionsAnalyzerResult,
	AISuggestionsBlockPolicy,
	AISuggestionsController,
	AISuggestionsExtensionConfig,
	AISuggestionsMode,
	AISuggestionsMetrics,
	AISuggestionsState,
} from "./types";
