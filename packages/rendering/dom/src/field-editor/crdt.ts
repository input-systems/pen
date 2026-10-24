import type { DocumentOp, Editor } from "@input/pen-types";

/** One Quill-style delta op, the shape `Y.Text.toDelta()` and Yjs text events emit. */
export type FieldEditorDelta = {
	retain?: number;
	insert?: string | Record<string, unknown>;
	delete?: number;
	attributes?: Record<string, unknown>;
};

/** The `Y.Text` surface a field editor reads and observes, kept structural so pen-dom does not import Yjs. */
export type FieldEditorTextLike = {
	length: number;
	toString(): string;
	insert(offset: number, text: string): void;
	delete(offset: number, length: number): void;
	observe(callback: (event: FieldEditorTextChangeEvent) => void): unknown;
	unobserve(callback: unknown): void;
	toDelta(): FieldEditorDelta[];
};

/** The change event a `FieldEditorTextLike` observer receives, mirroring Yjs `YTextEvent`. */
export type FieldEditorTextChangeEvent = {
	delta: FieldEditorDelta[];
	transaction?: {
		origin?: unknown;
		/** Yjs `Transaction.local`: `false` when the change arrived through `applyUpdate`. */
		local?: boolean;
	};
};

/** Callback registered with `FieldEditorTextLike.observe`. */
export type FieldEditorObserver = (event: FieldEditorTextChangeEvent) => void;

/** Inline input-rule matcher (autoformat) the field editor runs on typed text; returns the ops to apply, or `null` for no match. */
export type InlineInputRuleEngine = {
	tryMatchInline(
		editor: Editor,
		blockId: string,
		insertedText: string,
		options?: { offset?: number },
	): DocumentOp[] | null;
};
