/**
 * Documented agentic-loop model-pass bound (`maxSteps` in `@input/pen-ai`,
 * default 10). This package does not enforce steps; the loop does. Op budgets
 * are enforced atomically: a batch that does not fit is rejected whole with a
 * visible error instead of being applied partially. Exceeding the per-call
 * budget fails only that call; exhausting the turn budget ends the turn.
 */
export const AI_AGENTIC_MAX_STEPS_DEFAULT = 10;

/** Maximum model-requested tool calls in one turn, including denied attempts. */
export const AI_TOOL_MAX_CALLS_PER_TURN = 20;

/** Maximum document ops a single permitted tool call may apply. */
export const AI_TOOL_MAX_OPS_PER_CALL = 200;

/** Maximum document ops a turn may apply in total. */
export const AI_TOOL_MAX_TOTAL_OPS_PER_TURN = 800;

export const AI_TOOL_UNCONFIRMED_CODE = "ai-tool-unconfirmed";

/** A tool classified read-only called `editor.apply` or `openTextStream`; the write was dropped. */
export const AI_TOOL_READ_ONLY_MUTATION_CODE = "ai-tool-read-only-mutation";

/**
 * A tool call in the agentic loop threw. The turn continues; the error is fed
 * back to the model as the tool's result, so it may retry.
 *
 * The loop used to report this to the model only. A malformed `edit_document`
 * payload is the case that matters: it is rejected before any op is applied, so
 * the document is untouched and nothing throws out of `runPrompt` — from the
 * host's side the turn simply did nothing, with no way to tell a refusal from a
 * model that chose not to edit. UC2 requires the refusal be observable. The
 * streaming path already emitted `stream-tool-error` for the same failure.
 */
export const AI_TOOL_FAILED_CODE = "ai-tool-failed";

export const AI_READ_ONLY_TOOL_NAMES = [
	"read_document",
	"get_context",
	"get_cursor_context",
	"inspect_target",
	"list_valid_operations",
	"search_document",
	"retrieve_document_spans",
	"list_block_types",
] as const;

/**
 * Read tools a `tool-edit` pass may still need when the working set has no
 * `<!-- block:<id> <type> -->` annotations. `inspect_target` and
 * `list_valid_operations` describe the older per-block mutators, not
 * `edit_document`; they stay off this route. Keep the rest: a large document
 * can arrive without annotations, and dropping search/retrieve would leave
 * no way to find a target.
 */
export const AI_EDIT_CHANNEL_DISCOVERY_TOOL_NAMES = [
	"read_document",
	"get_context",
	"get_cursor_context",
	"search_document",
	"retrieve_document_spans",
	"list_block_types",
] as const;

/**
 * The edit channel's one mutating tool (EC1). Named once because three
 * separate readers key on it: the loop's forced tool choice, its preview
 * gating, and the unapplied-edit report (RS3). A literal at each site is how
 * a rename leaves one of them silently watching a tool that no longer exists.
 */
export const AI_EDIT_DOCUMENT_TOOL_NAME = "edit_document";

export const AI_MUTATING_TOOL_NAMES = [
	"insert_block",
	"update_block",
	"delete_block",
	"move_block",
	"write_document",
	AI_EDIT_DOCUMENT_TOOL_NAME,
] as const;

/** Delete and replace-document-scale rewrites (AIB3 destructive). */
export const AI_DESTRUCTIVE_TOOL_NAMES = [
	"delete_block",
	"write_document",
	// edit_document declares a per-call resolver; this entry covers a
	// definition that declares nothing.
	AI_EDIT_DOCUMENT_TOOL_NAME,
] as const;

export const AI_READ_ONLY_TOOL_NAME_SET: ReadonlySet<string> = new Set(
	AI_READ_ONLY_TOOL_NAMES,
);

export const AI_DESTRUCTIVE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
	AI_DESTRUCTIVE_TOOL_NAMES,
);
