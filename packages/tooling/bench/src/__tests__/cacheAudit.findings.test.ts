import {
	createPeerHarness,
	generateMixedBlockSpecs,
	type PeerHarness,
	type TestBlock,
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
	mergeStateVectors,
	storedBlockStates,
} from "../cacheAudit/property";

/**
 * One regression per finding the widened cache property reproduced: each
 * builds the smallest peer schedule that broke a cache and asserts the cache
 * equals its naive recompute on every peer afterwards.
 */

const ROOT_COUNT = 40;

/** A callout holding one `children`-array child. */
function callout(id: string): TestBlock {
	return {
		id,
		type: "callout",
		content: id,
		children: [{ id: `${id}-1`, type: "paragraph", content: "one" }],
	};
}

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

	it("finding 3: a children entry whose block map arrives after it enters the preorder when the map lands", () => {
		const [a, b, local] = fork(3, [
			...generateMixedBlockSpecs(20),
			{
				id: "callout-a",
				type: "callout",
				content: "Box",
				children: [{ id: "callout-a-1", type: "paragraph", content: "one" }],
			},
		]);
		a!.apply([
			{
				type: "insert-block",
				blockId: "x",
				blockType: "paragraph",
				props: {},
				position: { after: "scale-block-3" },
			},
			{ type: "splice-text", blockId: "x", from: 0, to: 0, insert: "fox" },
		]);
		harness!.deliver(0, 1);
		b!.apply([
			{ type: "move-block", blockId: "x", position: { parent: "callout-a", index: 1 } },
		]);
		// b's own update, without what it learned from a: its children entry
		// lands before the block map a wrote.
		const since = mergeStateVectors([harness!.stateVector(2), harness!.stateVector(0)]);
		harness!.applyUpdateTo(2, harness!.encodeUpdate(1, since));
		expect(cacheProblems(local!)).toEqual([]);
		const touched = touchedProblems(local!, () => harness!.deliver(0, 2));
		expect(local!.documentState.childrenOf("callout-a")).toEqual(["callout-a-1", "x"]);
		expect(local!.documentState.preorderIndexOf("x")).toBe(
			local!.documentState.preorderIndexOf("callout-a-1") + 1,
		);
		expect(touched).toEqual([]);
		expect(cacheProblems(local!)).toEqual([]);
	});

	it("finding 5: a block two children arrays list keeps a parent when one entry goes", () => {
		const peers = fork(2, [
			...generateMixedBlockSpecs(20),
			callout("callout-a"),
			callout("callout-b"),
		]);
		const [left, right] = peers as [TestEditor, TestEditor];
		left.apply([
			{ type: "move-block", blockId: "scale-block-3", position: { parent: "callout-a", index: 0 } },
		]);
		right.apply([
			{ type: "move-block", blockId: "scale-block-3", position: { parent: "callout-b", index: 1 } },
		]);
		harness!.deliver(0, 1);
		harness!.deliver(1, 0);
		for (const editor of peers) expect(cacheProblems(editor)).toEqual([]);
		// Undo takes `scale-block-3` out of callout-b and back into the root
		// order, while callout-a still lists it.
		const manager = right.undoManager;
		manager.stopCapturing();
		expect(manager.undo()).toBe(true);
		expect(right.documentState.parentOf("scale-block-3")).toBe("callout-a");
		expect(cacheProblems(right)).toEqual([]);
		harness!.deliver(1, 0);
		expect(cacheProblems(left)).toEqual([]);
	});

	it("finding 7: a duplicate root entry landing directly before the original is reported", () => {
		const peers = fork(2);
		for (const editor of peers) {
			editor.apply([
				{ type: "move-block", blockId: "scale-block-5", position: { after: "scale-block-9" } },
			]);
		}
		// One of the two deliveries lands the peer's entry directly before the
		// receiver's own; both must report that the root order gained an entry.
		for (const [from, to] of [
			[0, 1],
			[1, 0],
		] as const) {
			const summaries: ChangeSummary[] = [];
			const off = peers[to]!.on("commit", (event: CommitEvent) => {
				summaries.push(event.summary);
			});
			harness!.deliver(from, to);
			off();
			const named = summaries.flatMap((summary) =>
				summary.structural.map((change) => ("blockId" in change ? change.blockId : null)),
			);
			expect(named).toContain("scale-block-5");
			expect(peers[to]!.documentState.blockOrder.filter((id) => id === "scale-block-5")).toHaveLength(2);
			expect(cacheProblems(peers[to]!)).toEqual([]);
		}
	});

	it("a first child's new array is reported when the same commit lists the block in another array too", () => {
		const peers = fork(3, [...generateMixedBlockSpecs(ROOT_COUNT), callout("callout-a")]);
		const [a, , d] = peers as [TestEditor, TestEditor, TestEditor];
		a.apply([
			{ type: "move-block", blockId: "scale-block-4", position: { parent: "callout-a", index: 2 } },
		]);
		// `scale-block-14` is a blockquote without a `children` array.
		d.apply([
			{ type: "move-block", blockId: "scale-block-4", position: { parent: "scale-block-14", index: 0 } },
		]);
		harness!.deliver(0, 2);
		const summaries: ChangeSummary[] = [];
		const off = peers[1]!.on("commit", (event: CommitEvent) => {
			summaries.push(event.summary);
		});
		harness!.deliver(2, 1);
		off();
		const targets = summaries.flatMap((summary) =>
			summary.structural.flatMap((change) =>
				change.type === "block-moved" && change.blockId === "scale-block-4"
					? [change.toParentId]
					: [],
			),
		);
		expect(targets.sort()).toEqual(["callout-a", "scale-block-14"]);
		expect(cacheProblems(peers[1]!)).toEqual([]);
	});

	it("a root block that loses its last children entry rejoins the top-level list", () => {
		const peers = fork(3, [
			...generateMixedBlockSpecs(ROOT_COUNT),
			callout("callout-a"),
			callout("callout-b"),
		]);
		const [b, c, e] = peers as [TestEditor, TestEditor, TestEditor];
		// b and e move one block to one place: b's root order lists it twice
		// until a pass there repairs it, so it holds no positions.
		for (const editor of [b, e]) {
			editor.apply([
				{ type: "move-block", blockId: "scale-block-5", position: { after: "scale-block-9" } },
			]);
		}
		b.undoManager.stopCapturing();
		b.apply([
			{ type: "move-block", blockId: "scale-block-1", position: { parent: "callout-b", index: 1 } },
		]);
		c.apply([
			{ type: "move-block", blockId: "scale-block-1", position: { parent: "scale-block-34", index: 0 } },
		]);
		harness!.deliver(1, 0);
		harness!.deliver(0, 1);
		harness!.deliver(2, 0);
		expect(b.documentState.blockOrder.filter((id) => id === "scale-block-5")).toHaveLength(2);
		expect(b.documentState.rootBlockIds()).not.toContain("scale-block-1");
		// b's undo puts the block back in the root order and out of
		// callout-b; scale-block-34 still lists it.
		b.undoManager.stopCapturing();
		expect(b.undoManager.undo()).toBe(true);
		expect(cacheProblems(b)).toEqual([]);
		b.documentState.rootBlockIds();
		// c's next pass keeps the lowest-id parent (callout-b) and drops the
		// scale-block-34 entry; on b that leaves only the root entry.
		c.apply([
			{ type: "splice-text", blockId: "callout-a-1", from: 0, to: 0, insert: "o" },
		]);
		harness!.deliver(1, 0);
		expect(cacheProblems(b)).toEqual([]);
		expect(b.documentState.rootBlockIds()).toContain("scale-block-1");
	});

	describe.each([
		{ name: "both keep their first child", deleteOn: null },
		{ name: "the lower peer deletes its first child", deleteOn: 0 },
		{ name: "the higher peer deletes its first child", deleteOn: 1 },
	])("finding 4: concurrent first-child inserts into one container ($name)", ({ deleteOn }) => {
		it("reports the losing array's children, re-homes them on every peer and converges", () => {
			const peers = fork(2);
			// `scale-block-14` is a blockquote: a container without a `children` array.
			const inserted = peers.map((editor, at) => {
				const blockId = `first-${at}`;
				editor.apply([
					{
						type: "insert-block",
						blockId,
						blockType: "paragraph",
						props: {},
						position: { parent: "scale-block-14", index: 0 },
					},
					{ type: "splice-text", blockId, from: 0, to: 0, insert: "fox" },
				]);
				return blockId;
			});
			if (deleteOn !== null) {
				peers[deleteOn]!.apply([{ type: "delete-block", blockId: inserted[deleteOn]! }]);
			}
			const touched = [
				touchedProblems(peers[1]!, () => harness!.deliver(0, 1)),
				touchedProblems(peers[0]!, () => harness!.deliver(1, 0)),
			];
			expect(touched).toEqual([[], []]);
			for (const editor of peers) expect(cacheProblems(editor)).toEqual([]);

			// The next local pass on each peer re-homes what its merge orphaned.
			for (const editor of peers) {
				editor.apply([
					{ type: "splice-text", blockId: "scale-block-1", from: 0, to: 0, insert: "o" },
				]);
				expect(cacheProblems(editor)).toEqual([]);
			}
			harness!.syncAll();
			for (const editor of peers) {
				editor.apply([
					{ type: "splice-text", blockId: "scale-block-2", from: 0, to: 0, insert: "o" },
				]);
			}
			harness!.syncAll();
			harness!.assertConverged();
			const survivors = inserted.filter((_, at) => at !== deleteOn);
			for (const editor of peers) {
				expect(cacheProblems(editor)).toEqual([]);
				const preorder = editor.documentState.preorderBlockIds();
				for (const blockId of survivors) {
					expect(preorder.filter((id) => id === blockId)).toHaveLength(1);
				}
			}
		});
	});
});
