# @input/pen-ai

## .

`./dist/index.d.ts`

### class

- AICommandRegistry

### function

- acceptAllSuggestions
- acceptSuggestion
- acceptSuggestions
- aiExtension
- applySuggestedAIOperations
- createSuggestionMark
- getAIController
- getAIInlineCompletionController
- getAIInlineHistoryController
- getAIReviewController
- readAllSuggestions
- readBlockSuggestionMeta
- readSuggestionsFromBlock
- rejectAllSuggestions
- rejectSuggestion
- rejectSuggestions
- runAgenticLoop

### value

- AI_EGRESS_INVENTORY_CODE
- AI_EXTENSION_NAME
- AI_FEATURE_CONTENT
- AI_REQUEST_REFUSED_CODE
- AI_SESSION_SUGGESTION_ORIGIN
- AI_TARGET_KINDS
- AI_TOOL_RESULT_MAX_CHARS
- aiEgressExtension
- aiEgressFacet
- defaultAICommands
- filterAIRequest
- REVIEW_SURFACE_BLOCK_SUGGESTION_CLASSES
- REVIEW_SURFACE_CLASSES
- REVIEW_SURFACE_CUSTOM_PROPERTIES
- streamThroughEgress
- SUGGESTION_RESOLUTION_ORIGIN

### type

- AgenticStep
- AIAwarenessState
- AICommandBinding
- AICommandContext
- AICommandExecutionOptions
- AICommandGuard
- AIContentFormatOptions
- AIContextualPromptAnchor
- AIContextualPromptAnchorKind
- AIContextualPromptAnchorStatus
- AIContextualPromptComposerState
- AIContextualPromptRect
- AIContextualPromptState
- AIController
- AIControllerState
- AIEditStreaming
- AIExtensionConfig
- AIExternalInlineTurnResult
- AIInlineCompletionController
- AIInlineCompletionState
- AIInlineHistoryController
- AIInlineHistoryDirection
- AIMutationPreference
- AIMutationReceipt
- AIMutationReceiptEvidence
- AIMutationReceiptStatus
- AIPromptTarget
- AIReviewController
- AISession
- AISessionAnchor
- AISessionCommitMetrics
- AISessionMetrics
- AISessionPrompt
- AISessionResolution
- AISessionStatus
- AISessionTarget
- AIStatus
- AIStreamEvent
- AIStreamEventType
- AIStreamingReviewPreview
- AIStreamingReviewPreviewInput
- AIStreamingReviewPreviewTarget
- AISuggestionPresentation
- AISurface
- AITargetKind
- AIWorkingSetRetrievedSpan
- ApplySuggestedAIOperationsOptions
- ApplySuggestedAIOperationsResult
- BlockSuggestion
- BlockSuggestionMeta
- CommitDebugState
- EphemeralSuggestion
- GenerationState
- GenerationTargetKind
- PersistentBlockSuggestion
- PersistentSuggestion
- PersistentTextSuggestion
- StructuredGenerationDebugState

## ./suggestions

`./dist/suggestions.d.ts`

### function

- aiSuggestionsExtension
- buildAISuggestionMessages
- getAISuggestionsController
- parseSuggestionResponse

### value

- AI_SUGGESTIONS_EXTENSION_NAME
- AI_SUGGESTIONS_REQUEST_MODE
- AI_SUGGESTIONS_SYSTEM_PROMPT
- DEFAULT_ALLOWED_BLOCK_TYPES
- DEFAULT_CACHE_TTL_MS
- DEFAULT_COOLDOWN_MS
- DEFAULT_DEBOUNCE_MS
- DEFAULT_DISMISS_MEMORY_MS
- DEFAULT_GROUP_GAP_CHARS
- DEFAULT_MAX_SCOPE_CHARS
- DEFAULT_MAX_SUGGESTIONS_PER_SCOPE
- DEFAULT_MIN_CHANGED_CHARS
- DEFAULT_MIN_CONFIDENCE
- DEFAULT_MIN_STABLE_MS

### type

- AISuggestion
- AISuggestionCandidate
- AISuggestionGroup
- AISuggestionKind
- AISuggestionsAnalyzer
- AISuggestionsAnalyzerResult
- AISuggestionsBlockPolicy
- AISuggestionsController
- AISuggestionScope
- AISuggestionsExtensionConfig
- AISuggestionsMetrics
- AISuggestionsMode
- AISuggestionsState

## ./autocomplete

`./dist/autocomplete.d.ts`

### function

- autocompleteExtension
- getAutocompleteController

### value

- AI_AUTOCOMPLETE_EXTENSION_NAME
- AUTOCOMPLETE_SYSTEM_PROMPT
- AutocompleteContextProvider
- AutocompleteProviderDescriptor
- AutocompleteProviderSection
- AutocompleteProviderTiming
- AutocompleteRequestContext
- builtinAutocompleteProviders
- createAutocompleteProvider

### type

- AutocompleteAcceptanceStrategy
- AutocompleteBlockedReason
- AutocompleteBlockPolicy
- AutocompleteController
- AutocompleteControllerSnapshot
- AutocompleteControllerState
- AutocompleteDiagnostics
- AutocompleteDismissReason
- AutocompleteExtensionConfig
- AutocompleteMetrics
- AutocompletePolicyInvalidationStage
- AutocompleteRuntimeSettings

## ./skills

`./dist/skills.d.ts`

### function

- listDefaultAISkills
- renderSkillFiles

### type

- AISkillDefinition
- AISkillFile
- AISkillScript

## ./tools

`./dist/tools.d.ts`

### function

- executeAITool
- getAIToolRuntime
- listAITools
- openAIToolCall

### value

- AI_AGENTIC_MAX_STEPS_DEFAULT
- AI_DESTRUCTIVE_TOOL_NAMES
- AI_MUTATING_TOOL_NAMES
- AI_READ_ONLY_TOOL_NAMES
- AI_TOOL_MAX_CALLS_PER_TURN
- AI_TOOL_MAX_OPS_PER_CALL
- AI_TOOL_MAX_TOTAL_OPS_PER_TURN
- AI_TOOL_READ_ONLY_MUTATION_CODE
- AI_TOOL_UNCONFIRMED_CODE
- AIToolAuthorityReason
- AIToolAuthorization
- AIToolBudgetLimits
- AIToolCallDenied
- AIToolCallStatus
- AIToolConfirmationDecision
- AIToolConfirmationRequest
- AIToolConfirmFn
- AIToolContextImpl
- AIToolDescriptor
- AIToolGrant
- AIToolRuntime
- AIToolRuntimeImpl
- AIToolTurn
- AIToolTurnOptions
- authorizeAIToolCall
- createAIToolTurn
- isAIToolCallDenied
- isDestructiveAITool
- isMutatingAITool

### type

- OpenAIToolCall

## ./stream

`./dist/stream.d.ts`

### function

- deltaStreamExtension
- getSmoothStreamController
- processStream
- smoothStreamExtension

### value

- SMOOTH_STREAM_EXTENSION_NAME

### type

- DeltaStreamOptions
- ProcessStreamOptions
- SmoothStreamController
- SmoothStreamOptions
- SmoothStreamStatus
