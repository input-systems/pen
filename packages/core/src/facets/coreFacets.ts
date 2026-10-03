import type {
	ApplyOptions,
	AssetProvider,
	ChangeSummary,
	CommandHandlerRegistration,
	Decoration,
	DecorationSet,
	DocumentOp,
	DocumentState,
	Editor,
	Importer,
	InputRule,
	KeyBinding,
	OpOrigin,
} from "@input/pen-types";

import { defineFacet } from "./defineFacet";

export type Keymap = readonly KeyBinding[];

export type BeforeApplyHook = (
	ops: DocumentOp[],
	options: ApplyOptions,
) => DocumentOp[];

/** What a scoped decoration source sees when deciding its interest in a commit. */
export interface DecorationInterest {
	readonly summary: ChangeSummary;
	readonly origin: OpOrigin;
}

/**
 * A decorations source that recomputes only the blocks a commit touches
 * (SCALE2). Pass it to `scopedDecorationSource` instead of a function-form
 * `decorationsFacet` source.
 */
export interface ScopedDecorationSourceSpec {
	/**
	 * Blocks to recompute for this commit. Omitted: `summary.affectedBlockIds`.
	 * `null` or `[]`: no interest, and `decorate` is not called. `"all"`: every
	 * block in document order. Must cost O(1) or O(|summary|) (SCALE2).
	 */
	interest?(event: DecorationInterest): readonly string[] | "all" | null;
	/**
	 * Decorations for exactly `blockIds`. An entry for any other block is
	 * dropped with a `decoration-out-of-scope` diagnostic.
	 */
	decorate(blockIds: readonly string[], editor: Editor): readonly Decoration[];
}

/** A `ScopedDecorationSourceSpec` tagged for `decorationsFacet` (SCALE2). */
export interface ScopedDecorationSource extends ScopedDecorationSourceSpec {
	readonly kind: "scoped";
}

/**
 * The scoped form of a `decorationsFacet` source (SCALE2): called per commit
 * with only the blocks it declares interest in, so its per-keystroke cost
 * follows the change rather than the document.
 */
export function scopedDecorationSource(
	spec: ScopedDecorationSourceSpec,
): ScopedDecorationSource {
	return {
		kind: "scoped",
		interest: spec.interest,
		decorate: spec.decorate,
	};
}

export function isScopedDecorationSource(
	source: unknown,
): source is ScopedDecorationSource {
	return (
		source != null &&
		typeof source === "object" &&
		(source as { kind?: unknown }).kind === "scoped"
	);
}

/**
 * A function source is interested in every commit and recomputed in full; a
 * static set is constant; a scoped source recomputes only what it names.
 */
export type DecorationSource =
	| ((state: DocumentState, editor: Editor) => DecorationSet)
	| DecorationSet
	| ScopedDecorationSource;

export type ClipboardHandler = {
	readonly html?: Importer;
	readonly markdown?: Importer;
	readonly assets?: AssetProvider;
};

function isClipboardHandlerTable(value: unknown): value is ClipboardHandler {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergeClipboardHandlers(
	inputs: readonly ClipboardHandler[],
): ClipboardHandler {
	const merged: {
		html?: Importer;
		markdown?: Importer;
		assets?: AssetProvider;
	} = {};
	for (const input of inputs) {
		if (!isClipboardHandlerTable(input)) {
			continue;
		}
		if (input.html !== undefined) {
			merged.html = input.html;
		}
		if (input.markdown !== undefined) {
			merged.markdown = input.markdown;
		}
		if (input.assets !== undefined) {
			merged.assets = input.assets;
		}
	}
	return merged;
}

export type CommandHandlerTable = {
	readonly [commandName: string]: readonly CommandHandlerRegistration[];
};

export const keymapFacet = defineFacet<Keymap, readonly KeyBinding[]>({
	name: "pen.keymap",
	combine: (inputs) => inputs.flat(),
});

export const beforeApplyFacet = defineFacet<
	BeforeApplyHook,
	readonly BeforeApplyHook[]
>({
	name: "pen.beforeApply",
	combine: (inputs) => inputs,
});

export const decorationsFacet = defineFacet<
	DecorationSource,
	readonly DecorationSource[]
>({
	name: "pen.decorations",
	combine: (inputs) => inputs,
});

export const inputRulesFacet = defineFacet<InputRule, readonly InputRule[]>({
	name: "pen.inputRules",
	combine: (inputs) => inputs,
});

export const commandsFacet = defineFacet<
	CommandHandlerRegistration,
	CommandHandlerTable
>({
	name: "pen.commands",
	combine: (inputs) => {
		const table: Record<string, CommandHandlerRegistration[]> = {};
		for (const registration of inputs) {
			const name = registration.command.name;
			const handlers = table[name];
			if (handlers) {
				handlers.push(registration);
			} else {
				table[name] = [registration];
			}
		}
		return table;
	},
});

export const ariaReadOnlyFacet = defineFacet<boolean, boolean>({
	name: "pen.ariaReadOnly",
	combine: (inputs) => inputs.some((value) => value),
});

export const clipboardFacet = defineFacet<ClipboardHandler, ClipboardHandler>({
	name: "pen.clipboard",
	combine: mergeClipboardHandlers,
});
