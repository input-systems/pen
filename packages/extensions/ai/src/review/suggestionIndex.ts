import type { Decoration, Editor } from "@input/pen-types";

import type { AIExtensionConfig } from "../types";
import {
	suggestionDecorationsForBlock,
	type SuggestionInlineRange,
} from "./suggestionDecorations";

type SuggestionPresentation = NonNullable<AIExtensionConfig["suggestionPresentation"]>;

/**
 * Suggestion decorations kept per block (SCALE2). The review source asks it
 * to refresh only the blocks a commit touched, so a keystroke reads one
 * block's meta and marks instead of every block's `toDelta()`.
 */
export class SuggestionDecorationIndex {
	private readonly _decorations = new Map<string, Decoration[]>();
	private readonly _ranges = new Map<string, SuggestionInlineRange[]>();

	constructor(private readonly _presentation: SuggestionPresentation) {}

	// Read through the structural `suggestions` parameter of
	// buildAIReviewPresentationDecorations, which fallow cannot follow.
	// fallow-ignore-next-line unused-class-member
	get hasSuggestions(): boolean {
		return this._decorations.size > 0;
	}

	// fallow-ignore-next-line unused-class-member
	get rangesByBlock(): Map<string, SuggestionInlineRange[]> {
		return this._ranges;
	}

	/** Re-reads `blockIds` and returns their decorations; a missing block is dropped. */
	refresh(editor: Editor, blockIds: readonly string[]): Decoration[] {
		const decorations: Decoration[] = [];
		for (const blockId of blockIds) {
			const entry = suggestionDecorationsForBlock(editor, blockId, this._presentation);
			if (!entry) {
				this._decorations.delete(blockId);
				this._ranges.delete(blockId);
				continue;
			}
			this._decorations.set(blockId, entry.decorations);
			if (entry.ranges.length > 0) this._ranges.set(blockId, entry.ranges);
			else this._ranges.delete(blockId);
			decorations.push(...entry.decorations);
		}
		return decorations;
	}

	/**
	 * Forgets blocks a commit removed. Their stored map can outlive them (a
	 * `children`-array descendant of a deleted block), and the collector does
	 * not ask a source to re-read a removed block.
	 */
	drop(blockIds: readonly string[]): void {
		for (const blockId of blockIds) {
			this._decorations.delete(blockId);
			this._ranges.delete(blockId);
		}
	}

	clear(): void {
		this._decorations.clear();
		this._ranges.clear();
	}
}
