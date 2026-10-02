export {
	autocompleteExtension,
	AI_AUTOCOMPLETE_EXTENSION_NAME,
	getAutocompleteController,
} from "./extension";
export { createAutocompleteProvider } from "./providers/types";
export { builtinAutocompleteProviders } from "./providers/builtins";
export { AUTOCOMPLETE_SYSTEM_PROMPT } from "./promptBuilder";

export type {
	AutocompleteAcceptanceStrategy,
	AutocompleteBlockedReason,
	AutocompleteBlockPolicy,
	AutocompleteController,
	AutocompleteControllerSnapshot,
	AutocompleteControllerState,
	AutocompleteDiagnostics,
	AutocompleteDismissReason,
	AutocompleteExtensionConfig,
	AutocompleteMetrics,
	AutocompleteParagraphGap,
	AutocompletePolicyInvalidationStage,
	AutocompleteRequestContext,
	AutocompleteRuntimeSettings,
} from "./types";
export type {
	AutocompleteContextProvider,
	AutocompleteProviderDescriptor,
	AutocompleteProviderSection,
	AutocompleteProviderTiming,
} from "./providers/types";
