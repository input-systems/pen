import { aiExtension, getAIController, readAllSuggestions } from "@input/pen-ai";
import { deltaStreamExtension } from "@input/pen-ai/stream";
import { getSearchController, searchExtension } from "@input/pen-search";
import { toolsExtension } from "@input/pen-tools";
import { undoExtension } from "@input/pen-undo";
import { createModelDouble, createTestEditor, type TestEditor } from "@input/pen-test";
import { createScale3YDoc, scale3KeystrokeTarget } from "./scale3Stack";

/**
 * SCALE3 realistic variant (W1-S7): the keystroke a host ships with the real
 * `aiExtension` holding staged suggestions and the real `searchExtension`
 * holding an active query, instead of no-op stand-ins. Suggestions,
 * autocomplete and multiplayer stay stand-ins in the plain SCALE3 stack.
 */

export const SCALE3_REALISTIC_BLOCK_COUNTS = [100, 1000, 5000] as const;
export type Scale3RealisticBlockCount = (typeof SCALE3_REALISTIC_BLOCK_COUNTS)[number];

export interface Scale3RealisticOptions {
	readonly blockCount: Scale3RealisticBlockCount;
	/** Suggestions staged through the real suggest-mode path. Default 8. */
	readonly stagedSuggestions?: number;
	/** Active search query. Default matches exactly one block. */
	readonly searchQuery?: string;
}

export const SCALE3_REALISTIC_STAGED = 8;
export const SCALE3_REALISTIC_QUERY = "for block 42.";

function stageSuggestions(editor: TestEditor, blockCount: number, staged: number): void {
	const stride = Math.floor(blockCount / (staged + 1));
	for (let k = 1; k <= staged; k += 1) {
		const blockId = `block-${k * stride}`;
		const end = editor.getBlock(blockId).textContent().length;
		editor.apply(
			[{ type: "splice-text", blockId, from: end, to: end, insert: " suggested" }],
			{ origin: { type: "ai" } },
		);
	}
}

export async function createScale3RealisticEditor(
	options: Scale3RealisticOptions,
): Promise<TestEditor> {
	const editor = createTestEditor({
		doc: createScale3YDoc(options.blockCount),
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({ suggestMode: true, model: createModelDouble({ parts: [] }) }),
			searchExtension(),
		],
	});
	await Promise.resolve();
	stageSuggestions(editor, options.blockCount, options.stagedSuggestions ?? SCALE3_REALISTIC_STAGED);
	getAIController(editor)?.setSuggestMode(false);
	getSearchController(editor)?.setQuery(options.searchQuery ?? SCALE3_REALISTIC_QUERY);
	return editor;
}

/** What must be true before a count is trusted: real suggestions and one match. */
export function observeScale3Realistic(editor: TestEditor): {
	suggestionBlocks: number;
	searchMatches: number;
} {
	const blocks = new Set(readAllSuggestions(editor).map((suggestion) => suggestion.blockId));
	return {
		suggestionBlocks: blocks.size,
		searchMatches: getSearchController(editor)?.getState().matches.length ?? 0,
	};
}

/** The SCALE3 keystroke: one `x` into the middle block. */
export function scale3RealisticKeystroke(editor: TestEditor, blockCount: number): void {
	const blockId = scale3KeystrokeTarget(blockCount);
	const at = editor.getBlock(blockId).textContent().length;
	editor.apply([{ type: "splice-text", blockId, from: at, to: at, insert: "x" }], {
		origin: "user",
	});
}
