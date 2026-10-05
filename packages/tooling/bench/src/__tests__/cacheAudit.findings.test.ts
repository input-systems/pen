import {
	createPeerHarness,
	generateMixedBlockSpecs,
	type PeerHarness,
	type TestEditor,
} from "@input/pen-test";
import type { ChangeSummary, CommitEvent, Editor } from "@input/pen-types";
import { searchExtension, getSearchController } from "@input/pen-search";
import { undoExtension } from "@input/pen-undo";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadAuditInternals, type AuditInternals } from "../cacheAudit/internals";
import {
	checkBlockIndex,
	checkDocumentIndex,
	checkPassIndex,
	checkSearch,
	checkTouchedIds,
	storedBlockStates,
} from "../cacheAudit/property";

/**
 * One regression per finding the widened cache property reproduced: each
 * builds the smallest peer schedule that broke a cache and asserts the cache
 * equals its naive recompute on every peer afterwards.
 */

const ROOT_COUNT = 40;

let internals: AuditInternals;
let harness: PeerHarness | null = null;

beforeAll(async () => {
	internals = await loadAuditInternals();
});

afterEach(() => {
	harness?.destroy();
	harness = null;
});

function fork(count: number, blocks = generateMixedBlockSpecs(ROOT_COUNT)): TestEditor[] {
	harness = createPeerHarness(count, {
		blocks,
		extensionsFor: () => [undoExtension(), searchExtension()],
	});
	return harness.peers.map((peer) => {
		const editor = peer.editor;
		// The caches read removed blocks and expect null, as the runtime returns.
		delete (editor as { getBlock?: unknown }).getBlock;
		const search = getSearchController(editor);
		search?.setQuery("ox");
		search?.open();
		return editor;
	});
}

/** A, B, F and G on one peer. */
function cacheProblems(editor: Editor): string[] {
	return [
		...checkDocumentIndex(editor),
		...checkBlockIndex(editor, internals),
		...checkSearch(editor),
		...checkPassIndex(editor),
	];
}

/** Every summary `editor` commits while `run` runs, and the touched-id check over it. */
function touchedProblems(editor: Editor, run: () => void): string[] {
	const summaries: ChangeSummary[] = [];
	const before = storedBlockStates(editor);
	const off = editor.on("commit", (event: CommitEvent) => {
		summaries.push(event.summary);
	});
	try {
		run();
	} finally {
		off();
	}
	return checkTouchedIds(before, storedBlockStates(editor), summaries);
}

function engineOf(editor: Editor): { passIndex: unknown } {
	return editor.internals.engine as unknown as { passIndex: unknown };
}

describe("cache property findings", () => {
	it("finding 1: closing a stream normalizes its block inside one transaction, so the pass index advances once", () => {
		const [local, remote] = fork(2);
		const writer = local!.openTextStream(
			{ blockId: "scale-block-5" },
			{ origin: "ai" },
		);
		// Both peers move the streamed block: the merge lists it twice in the
		// root order, and the deferred block keeps the duplicate until close.
		local!.apply([
			{ type: "move-block", blockId: "scale-block-5", position: { after: "scale-block-20" } },
		]);
		remote!.apply([
			{ type: "move-block", blockId: "scale-block-5", position: { after: "scale-block-30" } },
		]);
		harness!.deliver(1, 0);
		writer.append(" more");
		writer.flush();
		expect(engineOf(local!).passIndex).not.toBeNull();
		writer.close();
		expect(cacheProblems(local!)).toEqual([]);
		expect(local!.documentState.blockOrder.filter((id) => id === "scale-block-5")).toHaveLength(1);

		// The stale index resolved this delete to the wrong entry.
		local!.apply([{ type: "delete-block", blockId: "scale-block-34" }]);
		expect(local!.documentState.blockOrder).toContain("scale-block-33");
		expect(local!.documentState.blockOrder).not.toContain("scale-block-34");
		expect(cacheProblems(local!)).toEqual([]);
	});

	it("finding 2: several parentId siblings moving in one apply keep their parent's children in root order", () => {
		const [local, remote] = fork(2, [
			...generateMixedBlockSpecs(20),
			{ id: "t", type: "toggle", props: { open: true }, content: "T" },
			{ id: "c0", type: "paragraph", props: { parentId: "t" }, content: "zero" },
			{ id: "c1", type: "paragraph", props: { parentId: "t" }, content: "one" },
			{ id: "c2", type: "paragraph", props: { parentId: "t" }, content: "two" },
		]);
		for (const editor of [local!, remote!]) {
			expect(editor.documentState.childrenOf("t")).toEqual(["c0", "c1", "c2"]);
		}
		local!.apply([
			{ type: "move-block", blockId: "c0", position: { after: "c2" } },
			{ type: "move-block", blockId: "c1", position: { after: "c0" } },
		]);
		expect(local!.documentState.childrenOf("t")).toEqual(["c2", "c0", "c1"]);
		expect(cacheProblems(local!)).toEqual([]);
		harness!.deliver(0, 1);
		expect(remote!.documentState.childrenOf("t")).toEqual(["c2", "c0", "c1"]);
		expect(cacheProblems(remote!)).toEqual([]);
	});
});
