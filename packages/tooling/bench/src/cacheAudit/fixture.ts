import { aiExtension, getAIController } from "@input/pen-ai";
import { deltaStreamExtension } from "@input/pen-ai/stream";
import { getSearchController, searchExtension } from "@input/pen-search";
import {
	createModelDouble,
	createTestEditor,
	generateMixedBlockSpecs,
	mixedBlockId,
	mixedFixtureOps,
	type TestEditor,
} from "@input/pen-test";
import { toolsExtension } from "@input/pen-tools";
import type { DiagnosticEvent } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import type { AuditBlockNotifier, AuditInternals } from "./internals";

/** Suggestions staged through the real suggest-mode path, as in the SCALE3 realistic stack. */
const STAGED_SUGGESTIONS = 8;
/** Matches exactly one block of the mixed fixture. */
export const AUDIT_SEARCH_QUERY = "Block 42 ";
/**
 * Diagnostics an audit run may raise. Every caret write mints the authority's
 * two anchors (AS1) and AN9's live count never decrements, so enough timed
 * selection writes (a larger `--runs`) cross the 4,096 budget by churn, which
 * AN9 states as intended. Anything else means the audit measured an invalid
 * state, and the run fails.
 */
const EXPECTED_DIAGNOSTICS: ReadonlySet<string> = new Set(["anchor-budget"]);

export interface AuditEditor {
	readonly editor: TestEditor;
	/** Subscribed like a non-virtualized renderer: every root block, the document and the root list. */
	readonly notifier: AuditBlockNotifier;
	/** Diagnostics outside `EXPECTED_DIAGNOSTICS`: any means the audit measured an invalid state. */
	unexpectedDiagnostics(): readonly DiagnosticEvent[];
	destroy(): void;
}

function stageSuggestions(editor: TestEditor, rootCount: number): void {
	const stride = Math.floor(rootCount / (STAGED_SUGGESTIONS + 1));
	for (let k = 1; k <= STAGED_SUGGESTIONS; k += 1) {
		// Slot 2 of each period is a plain paragraph.
		const index = Math.floor((k * stride) / 20) * 20 + 2;
		const blockId = mixedBlockId(index);
		const end = editor.getBlock(blockId).textContent().length;
		editor.apply([{ type: "splice-text", blockId, from: end, to: end, insert: " suggested" }], {
			origin: { type: "ai" },
		});
	}
}

/**
 * The mixed scale fixture on the realistic extension stack: undo, tools, the
 * real AI extension holding staged suggestions and the real search extension
 * holding an open, active query, plus a block notifier subscribed the way a
 * renderer without virtualization subscribes.
 */
export async function createAuditEditor(
	rootCount: number,
	internals: AuditInternals,
): Promise<AuditEditor> {
	const editor = createTestEditor({
		blocks: generateMixedBlockSpecs(rootCount),
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({ suggestMode: true, model: createModelDouble({ parts: [] }) }),
			searchExtension(),
		],
	});
	const unexpected: DiagnosticEvent[] = [];
	const unsubscribeDiagnostics = editor.on("diagnostic", (event) => {
		if (!EXPECTED_DIAGNOSTICS.has(event.code)) unexpected.push(event);
	});
	editor.apply(mixedFixtureOps(rootCount), { origin: "system" });
	// The test editor's `getBlock` throws for a missing block; the notifier
	// reads a removed block and expects null, as the runtime returns.
	delete (editor as { getBlock?: unknown }).getBlock;
	await Promise.resolve();
	stageSuggestions(editor, rootCount);
	getAIController(editor)?.setSuggestMode(false);
	const search = getSearchController(editor);
	search?.setQuery(AUDIT_SEARCH_QUERY);
	search?.open();

	const notifier = internals.createBlockNotifier(editor);
	const noop = () => {};
	const unsubscribes = [
		notifier.subscribeDocument(noop),
		notifier.subscribeListSegments(null, noop),
		...editor.documentState.blockOrder.map((blockId) => notifier.subscribeBlock(blockId, noop)),
	];
	notifier.getListSegments(null);
	return {
		editor,
		notifier,
		unexpectedDiagnostics: () => unexpected,
		destroy() {
			for (const unsubscribe of unsubscribes) unsubscribe();
			unsubscribeDiagnostics();
			notifier.destroy();
			void editor.destroy();
		},
	};
}
