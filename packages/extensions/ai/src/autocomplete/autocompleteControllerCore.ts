import type {
	Anchor,
	Editor,
	InlineCompletionController,
	ModelAdapter,
} from "@input/pen-types";
import { getOpOriginType } from "@input/pen-core";
import type { AutocompleteControllerHost } from "./autocompleteControllerHost";
import {
	acceptVisibleSuggestion,
	destroy,
	dismiss,
	getBlockPolicy,
	getSnapshot,
	getState,
	hasVisibleSuggestion,
	listProviderDescriptors,
	registerProvider,
	request,
	setEnabled,
	subscribe,
	updateBlockPolicy,
	updateRuntimeSettings,
} from "./autocompleteControllerLifecycle";
import {
	remapVisibleSuggestion,
	shouldDismissForSelectionChange,
} from "./autocompleteControllerRequest";
import { setState } from "./autocompleteControllerState";
import {
	DEFAULT_DEBOUNCE_MS,
	DEFAULT_MAX_NEIGHBOR_CHARS,
	DEFAULT_MAX_PREFIX_CHARS,
	DEFAULT_MAX_PROVIDER_CHARS,
	DEFAULT_MAX_PROVIDER_TIME_MS,
	DEFAULT_MAX_SUFFIX_CHARS,
	DEFAULT_PARAGRAPH_GAP,
	DEFAULT_PREFETCH_AFTER_ACCEPT,
	DEFAULT_STALE_AFTER_MS,
} from "./constants";
import { AutocompleteContinuationState } from "./continuationState";
import { builtinAutocompleteProviders } from "./providers/builtins";
import { AutocompleteProviderRegistry } from "./providers/registry";
import type {
	AutocompleteContextProvider,
	AutocompleteProviderDescriptor,
} from "./providers/types";
import type {
	AutocompleteAcceptanceStrategy,
	AutocompleteBlockPolicy,
	AutocompleteController,
	AutocompleteControllerSnapshot,
	AutocompleteControllerState,
	AutocompleteDismissReason,
	AutocompleteExtensionConfig,
	AutocompleteParagraphGap,
} from "./types";

export class AutocompleteControllerImpl
	implements AutocompleteController, AutocompleteControllerHost
{
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
	readonly _listeners = new Set<() => void>();
	_snapshot: AutocompleteControllerSnapshot | null = null;
	_providerDescriptorsSnapshot:
		readonly AutocompleteProviderDescriptor[] | null = null;
	_state: AutocompleteControllerState = {
		enabled: true,
		status: "idle",
		activeRequestId: null,
		visibleSuggestionId: null,
		settings: {
			debounceMs: DEFAULT_DEBOUNCE_MS,
			prefetchAfterAccept: DEFAULT_PREFETCH_AFTER_ACCEPT,
			acceptanceStrategy: "full",
			staleAfterMs: DEFAULT_STALE_AFTER_MS,
		},
		blockPolicy: {
			allowInCodeBlocks: true,
			allowInTables: false,
			deniedBlockTypes: [],
		},
		metrics: {
			requestCount: 0,
			successCount: 0,
			cancelCount: 0,
			staleDropCount: 0,
			explicitTabTriggerCount: 0,
			acceptCount: 0,
			policyInvalidationScheduledCount: 0,
			policyInvalidationRequestingCount: 0,
			policyInvalidationShowingCount: 0,
		},
		providerTimings: [],
		diagnostics: {
			lastDismissReason: null,
			lastBlockedReason: null,
			lastPolicyInvalidationStage: null,
		},
	};
	_debounceTimer: ReturnType<typeof setTimeout> | null = null;
	_abortController: AbortController | null = null;
	_unsubscribeSelection: (() => void) | null = null;
	_unsubscribeCommit: (() => void) | null = null;
	readonly _continuation = new AutocompleteContinuationState();
	_prefetchAbortController: AbortController | null = null;
	_visibleAnchor: Anchor | null = null;
	_visibleSuggestionId: string | null = null;

	constructor(
		editor: Editor,
		config: AutocompleteExtensionConfig,
		services: { inlineCompletion: InlineCompletionController },
	) {
		this._editor = editor;
		this._inlineCompletion = services.inlineCompletion;
		this._model = config.model;
		this._debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this._acceptanceStrategy = config.acceptanceStrategy ?? "full";
		this._staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
		this._paragraphGap = config.paragraphGap ?? DEFAULT_PARAGRAPH_GAP;
		this._state.blockPolicy = {
			allowInCodeBlocks: true,
			allowInTables: false,
			deniedBlockTypes: [],
			...config.blockPolicy,
		};
		this._maxPrefixChars =
			config.maxPrefixChars ?? DEFAULT_MAX_PREFIX_CHARS;
		this._maxSuffixChars =
			config.maxSuffixChars ?? DEFAULT_MAX_SUFFIX_CHARS;
		this._maxNeighborChars =
			config.maxNeighborChars ?? DEFAULT_MAX_NEIGHBOR_CHARS;
		this._maxProviderChars =
			config.maxProviderChars ?? DEFAULT_MAX_PROVIDER_CHARS;
		this._maxProviderTimeMs =
			config.maxProviderTimeMs ?? DEFAULT_MAX_PROVIDER_TIME_MS;
		this._prefetchAfterAccept =
			config.prefetchAfterAccept ?? DEFAULT_PREFETCH_AFTER_ACCEPT;
		this._providerRegistry = new AutocompleteProviderRegistry([
			...builtinAutocompleteProviders,
			...(config.providers ?? []),
		]);
		this._state.enabled = config.enabled ?? true;
		this._state.settings = {
			debounceMs: this._debounceMs,
			prefetchAfterAccept: this._prefetchAfterAccept,
			acceptanceStrategy: this._acceptanceStrategy,
			staleAfterMs: this._staleAfterMs,
		};

		this._unsubscribeSelection = this._editor.onSelectionChange(() => {
			if (shouldDismissForSelectionChange(this)) {
				dismiss(this, "selection-change");
			}
		});
		this._unsubscribeCommit = this._editor.on("commit", (event) => {
			if (!this._state.enabled) {
				return;
			}
			if (this._continuation.consumeAcceptedAiCommit(event.origin)) {
				return;
			}
			this._continuation.syncThroughCommit(this._editor, event.summary);
			if (!remapVisibleSuggestion(this, event.summary)) {
				dismiss(this, "external-edit");
			}
			const originType = getOpOriginType(event.origin);
			if (originType !== "user" && originType !== "input-rule") {
				return;
			}
			this.request();
		});
	}

	destroy(): void {
		destroy(this);
	}

	getSnapshot(): AutocompleteControllerSnapshot {
		return getSnapshot(this);
	}

	getState(): AutocompleteControllerState {
		return getState(this);
	}

	getBlockPolicy(): Readonly<AutocompleteBlockPolicy> {
		return getBlockPolicy(this);
	}

	subscribe(listener: () => void): () => void {
		return subscribe(this, listener);
	}

	setEnabled(enabled: boolean): void {
		setEnabled(this, enabled);
	}

	request(options?: { explicit?: boolean }): boolean {
		return request(this, options);
	}

	acceptVisibleSuggestion(): boolean {
		return acceptVisibleSuggestion(this);
	}

	hasVisibleSuggestion(): boolean {
		return hasVisibleSuggestion(this);
	}

	registerProvider(provider: AutocompleteContextProvider): () => void {
		return registerProvider(this, provider);
	}

	listProviderDescriptors(): readonly AutocompleteProviderDescriptor[] {
		return listProviderDescriptors(this);
	}

	updateRuntimeSettings(
		settings: Partial<AutocompleteControllerState["settings"]>,
	): void {
		updateRuntimeSettings(this, settings);
	}

	updateBlockPolicy(policy: Partial<AutocompleteBlockPolicy>): void {
		updateBlockPolicy(this, policy);
	}

	dismiss(reason?: AutocompleteDismissReason): void {
		dismiss(this, reason);
	}

	_setState(next: Partial<AutocompleteControllerState>): void {
		setState(this, next);
	}
}
