import type {
	Anchor,
	Editor,
	InlineCompletionController,
	ModelAdapter,
} from "@input/pen-types";
import type { AutocompleteContinuationState } from "./continuationState";
import type { AutocompleteProviderRegistry } from "./providers/registry";
import type { AutocompleteProviderDescriptor } from "./providers/types";
import type {
	AutocompleteAcceptanceStrategy,
	AutocompleteControllerSnapshot,
	AutocompleteControllerState,
	AutocompleteParagraphGap,
} from "./types";

export type AutocompleteControllerHost = {
	readonly _editor: Editor;
	readonly _model: ModelAdapter | undefined;
	_debounceMs: number;
	_acceptanceStrategy: AutocompleteAcceptanceStrategy;
	_staleAfterMs: number;
	readonly _paragraphGap: AutocompleteParagraphGap;
	readonly _maxPrefixChars: number;
	readonly _maxSuffixChars: number;
	readonly _maxNeighborChars: number;
	readonly _maxProviderChars: number;
	readonly _maxProviderTimeMs: number;
	_prefetchAfterAccept: boolean;
	readonly _providerRegistry: AutocompleteProviderRegistry;
	readonly _inlineCompletion: InlineCompletionController;
	readonly _listeners: Set<() => void>;
	_snapshot: AutocompleteControllerSnapshot | null;
	_providerDescriptorsSnapshot:
		readonly AutocompleteProviderDescriptor[] | null;
	_state: AutocompleteControllerState;
	_debounceTimer: ReturnType<typeof setTimeout> | null;
	_abortController: AbortController | null;
	_unsubscribeSelection: (() => void) | null;
	_unsubscribeCommit: (() => void) | null;
	readonly _continuation: AutocompleteContinuationState;
	_prefetchAbortController: AbortController | null;
	_visibleAnchor: Anchor | null;
	_visibleSuggestionId: string | null;
};
