import type { Editor, Extension, FacetProvider, KeyBinding } from "@input/pen-types";
import { SEARCH_CONTROLLER_SLOT } from "@input/pen-types";
import {
	decorationsFacet,
	scopedDecorationSource,
	defineExtension,
	keyBindingPriorityToPrecedence,
	keymapFacet,
	searchControllerFacet,
} from "@input/pen-core";
import { SearchControllerImpl } from "./controller";
import { buildSearchDecorations } from "./decorations";
import type { SearchController } from "./types";

export const SEARCH_EXTENSION_NAME = "search";

const SEARCH_KEY_BINDINGS: KeyBinding[] = [
	{
		key: "Mod-f",
		description: "Open search",
		handler: (editor, event) => {
			const controller = getSearchController(editor);
			if (!controller) {
				return false;
			}
			event.preventDefault();
			controller.open();
			return true;
		},
	},
	{
		key: "Mod-g",
		description: "Next search match",
		handler: (editor, event) => {
			const controller = getSearchController(editor);
			const state = controller?.getState();
			if (!controller || !state?.open || state.query.length === 0) {
				return false;
			}
			event.preventDefault();
			controller.next();
			return true;
		},
	},
	{
		key: "Shift-Mod-g",
		description: "Previous search match",
		handler: (editor, event) => {
			const controller = getSearchController(editor);
			const state = controller?.getState();
			if (!controller || !state?.open || state.query.length === 0) {
				return false;
			}
			event.preventDefault();
			controller.previous();
			return true;
		},
	},
	{
		key: "Enter",
		description: "Next search match",
		handler: (editor, event) => {
			const controller = getSearchController(editor);
			const state = controller?.getState();
			if (!controller || !state?.open || state.query.length === 0) {
				return false;
			}
			event.preventDefault();
			controller.next();
			return true;
		},
	},
	{
		key: "Shift-Enter",
		description: "Previous search match",
		handler: (editor, event) => {
			const controller = getSearchController(editor);
			const state = controller?.getState();
			if (!controller || !state?.open || state.query.length === 0) {
				return false;
			}
			event.preventDefault();
			controller.previous();
			return true;
		},
	},
	{
		key: "Escape",
		description: "Close search",
		handler: (editor, event) => {
			const controller = getSearchController(editor);
			const state = controller?.getState();
			if (!controller || !state?.open) {
				return false;
			}
			event.preventDefault();
			controller.close();
			return true;
		},
	},
];

export function searchExtension(): Extension {
	let activeEditor: Editor | null = null;
	let controller: SearchControllerImpl | null = null;
	let unsubscribeCommit: (() => void) | null = null;
	let unsubscribeController: (() => void) | null = null;
	// Blocks the last decoration pass gave matches, so a state change recomputes
	// exactly the blocks that gain or lose one (SCALE2).
	let decoratedBlockIds = new Set<string>();

	// Matches are controller state: a commit changes them only through the
	// controller's rescan, which then asks for the blocks that moved. The
	// source therefore has no interest in commits themselves.
	const matchSource = scopedDecorationSource({
		interest: () => null,
		decorate: (blockIds) => {
			const state = controller?.getState();
			if (!state) return [];
			const wanted = new Set(blockIds);
			return buildSearchDecorations(state).filter((decoration) =>
				wanted.has(decoration.blockId),
			);
		},
	});

	function requestChangedBlocks(editor: Editor): void {
		const state = controller?.getState();
		const next = new Set(
			state?.open ? state.matches.map((match) => match.blockId) : [],
		);
		const blockIds = [...new Set([...decoratedBlockIds, ...next])];
		decoratedBlockIds = next;
		if (blockIds.length === 0) return;
		editor.requestDecorationUpdate({ source: matchSource, blockIds });
	}

	return defineExtension({
		name: SEARCH_EXTENSION_NAME,
		facets: [
			...searchKeymapProviders(SEARCH_KEY_BINDINGS),
			decorationsFacet.of(matchSource),
		],

		activateClient: async ({ editor }) => {
			activeEditor = editor;
			controller = new SearchControllerImpl(editor);
			editor.internals.assignSlot(SEARCH_CONTROLLER_SLOT, controller);

			unsubscribeCommit = editor.on("commit", (event) => {
				controller?.recomputeForCommit(event.summary);
			});

			unsubscribeController = controller.subscribe(() => {
				if (activeEditor) requestChangedBlocks(activeEditor);
			});
		},

		deactivateClient: async () => {
			unsubscribeCommit?.();
			unsubscribeCommit = null;
			unsubscribeController?.();
			unsubscribeController = null;
			activeEditor?.internals.assignSlot(SEARCH_CONTROLLER_SLOT, null);
			controller = null;
			decoratedBlockIds = new Set();
			activeEditor = null;
		},
	});
}

export function getSearchController(editor: Editor): SearchController | null {
	return (editor.facet(searchControllerFacet) as SearchController | null) ?? null;
}

function searchKeymapProviders(
	bindings: readonly KeyBinding[],
): readonly FacetProvider[] {
	return bindings.map((binding) =>
		keymapFacet.of(
			[binding],
			keyBindingPriorityToPrecedence(binding.priority ?? 300),
		),
	);
}
