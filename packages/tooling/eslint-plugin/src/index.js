import { noAboveFloorApi } from "./rules/noAboveFloorApi.js";
import { noAriaHiddenVisible } from "./rules/noAriaHiddenVisible.js";
import { noAsciiWordBoundaries } from "./rules/noAsciiWordBoundaries.js";
import { noBareCaseFolding } from "./rules/noBareCaseFolding.js";
import { noBareRandomUuid } from "./rules/noBareRandomUuid.js";
import { noBidiOverride } from "./rules/noBidiOverride.js";
import { noBindingEditorSubscriptions } from "./rules/noBindingEditorSubscriptions.js";
import { noDomSelectionRead } from "./rules/noDomSelectionRead.js";
import { noDomSelectionWrite } from "./rules/noDomSelectionWrite.js";
import { noFrameworkFreeModulesInRenderers } from "./rules/noFrameworkFreeModulesInRenderers.js";
import { noHtmlInjectionSinks } from "./rules/noHtmlInjectionSinks.js";
import { noImplicitLocale } from "./rules/noImplicitLocale.js";
import { noJsonStringifySignatures } from "./rules/noJsonStringifySignatures.js";
import { noModuleScopeBrowserGlobals } from "./rules/noModuleScopeBrowserGlobals.js";
import { noPenDeepImports } from "./rules/noPenDeepImports.js";
import { noSelectionStateProperties } from "./rules/noSelectionStateProperties.js";
import { noSelectionTimers } from "./rules/noSelectionTimers.js";
import { noUnescapedMarkupConcat } from "./rules/noUnescapedMarkupConcat.js";
import { noUnscheduledMeasure } from "./rules/noUnscheduledMeasure.js";
import { noUnstyledFocus } from "./rules/noUnstyledFocus.js";
import { noUnscopedDecorationSource } from "./rules/noUnscopedDecorationSource.js";
import { noUserFacingLiterals } from "./rules/noUserFacingLiterals.js";
import { noNewOps } from "./rules/noNewOps.js";
import { noV1ExtensionFields } from "./rules/noV1ExtensionFields.js";

export const rules = {
	"no-above-floor-api": noAboveFloorApi,
	"no-aria-hidden-visible": noAriaHiddenVisible,
	"no-ascii-word-boundaries": noAsciiWordBoundaries,
	"no-bare-case-folding": noBareCaseFolding,
	"no-bare-random-uuid": noBareRandomUuid,
	"no-bidi-override": noBidiOverride,
	"no-binding-editor-subscriptions": noBindingEditorSubscriptions,
	"no-dom-selection-read": noDomSelectionRead,
	"no-dom-selection-write": noDomSelectionWrite,
	"no-framework-free-modules-in-renderers": noFrameworkFreeModulesInRenderers,
	"no-html-injection-sinks": noHtmlInjectionSinks,
	"no-implicit-locale": noImplicitLocale,
	"no-json-stringify-signatures": noJsonStringifySignatures,
	"no-module-scope-browser-globals": noModuleScopeBrowserGlobals,
	"no-pen-deep-imports": noPenDeepImports,
	"no-selection-state-properties": noSelectionStateProperties,
	"no-selection-timers": noSelectionTimers,
	"no-unscheduled-measure": noUnscheduledMeasure,
	"no-unescaped-markup-concat": noUnescapedMarkupConcat,
	"no-unstyled-focus": noUnstyledFocus,
	"no-unscoped-decoration-source": noUnscopedDecorationSource,
	"no-user-facing-literals": noUserFacingLiterals,
	"no-new-ops": noNewOps,
	"no-v1-extension-fields": noV1ExtensionFields,
};

export default { rules };
