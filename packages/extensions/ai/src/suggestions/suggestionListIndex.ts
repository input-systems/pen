import { summaryRemovedBlockIds, summaryTouchedBlockIds } from "@input/pen-core";
import type { ChangeSummary, Editor } from "@input/pen-types";

import type { PersistentSuggestion } from "../types";
import { readBlockSuggestions } from "./persistent";

/**
 * Persistent suggestions kept per block (SCALE2). A commit re-reads only the
 * blocks its summary names; the flat list is rebuilt from the blocks that
 * hold suggestions, in document order, so a keystroke reads one block instead
 * of walking the document. `readAllSuggestions` is the full walk it must equal.
 */
export class SuggestionListIndex {
	private readonly _byBlock = new Map<string, PersistentSuggestion[]>();
	private _ready = false;

	/** Re-reads every block. */
	refreshAll(editor: Editor): void {
		this._byBlock.clear();
		for (const block of editor.documentState.allBlocks()) {
			this._store(block.id, readBlockSuggestions(editor, block));
		}
		this._ready = true;
	}

	/** Re-reads the blocks the summaries touched; before a first full read, reads everything. */
	// Called through `this._suggestionList` in a `this: AIControllerImpl` method object.
	// fallow-ignore-next-line unused-class-member
	refreshForSummaries(editor: Editor, summaries: readonly ChangeSummary[]): void {
		if (!this._ready) {
			this.refreshAll(editor);
			return;
		}
		for (const summary of summaries) {
			// A removed block's stored map can outlive it (a `children`-array
			// descendant of a deleted block), so it is dropped, not re-read.
			const removed = new Set(summaryRemovedBlockIds(summary));
			for (const blockId of summaryTouchedBlockIds(summary)) {
				const block = removed.has(blockId) ? null : editor.getBlock(blockId);
				this._store(blockId, block ? readBlockSuggestions(editor, block) : []);
			}
		}
	}

	// fallow-ignore-next-line unused-class-member
	list(editor: Editor): PersistentSuggestion[] {
		const state = editor.documentState;
		// A block outside the preorder is stored but rendered nowhere (a COL4
		// orphan until the next local pass re-homes it); the full walk skips it.
		const blockIds = [...this._byBlock.keys()]
			.filter((blockId) => state.preorderIndexOf(blockId) >= 0)
			.sort((left, right) => state.preorderIndexOf(left) - state.preorderIndexOf(right));
		return blockIds.flatMap((blockId) => this._byBlock.get(blockId) ?? []);
	}

	private _store(blockId: string, suggestions: PersistentSuggestion[]): void {
		if (suggestions.length > 0) this._byBlock.set(blockId, suggestions);
		else this._byBlock.delete(blockId);
	}
}

