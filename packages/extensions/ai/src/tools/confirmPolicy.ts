import { defineFacet } from "@input/pen-core";
import type { Editor } from "@input/pen-types";

import type { AIToolConfirmFn, AIUnconfirmedDestructivePolicy } from "./authority";

/**
 * How destructive AI tool calls are confirmed (AIB3): the resolver that
 * decides them and what happens when there is none.
 */
export interface AIToolConfirmPolicy {
	readonly confirm?: AIToolConfirmFn;
	readonly unconfirmedDestructive?: AIUnconfirmedDestructivePolicy;
}

/**
 * The editor's configured confirmation policy. `aiExtension` publishes its
 * `confirm` / `unconfirmedDestructive` here, so tool surfaces outside the
 * controller (transports, `processStream`) apply the host's setting.
 */
export const aiToolConfirmPolicyFacet = defineFacet<
	AIToolConfirmPolicy,
	AIToolConfirmPolicy | null
>({
	name: "ai.toolConfirmPolicy",
	combine: (inputs) => inputs[0] ?? null,
});

/**
 * The confirmation policy a tool turn on `editor` runs under: each explicit
 * field wins, and an absent one falls back to the editor's configured policy.
 */
export function resolveAIToolConfirmPolicy(
	editor: Editor | null | undefined,
	explicit: AIToolConfirmPolicy = {},
): AIToolConfirmPolicy {
	const configured = editor ? editor.facet(aiToolConfirmPolicyFacet) : null;
	return {
		confirm: explicit.confirm ?? configured?.confirm,
		unconfirmedDestructive:
			explicit.unconfirmedDestructive ?? configured?.unconfirmedDestructive,
	};
}
