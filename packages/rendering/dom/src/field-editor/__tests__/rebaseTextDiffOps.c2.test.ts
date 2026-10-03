import { describe, expect, it } from "vitest";
import { computeAnchoredTextDiff } from "../textDiff";
import { runC2Case } from "./c2RebaseHarness";

/** C2 (D3) fixed cases. Each oracle is two converged `Y.Doc`s, remote first. */
describe("C2 rebaseTextDiffOps", () => {
	it("C2: a remote insert strictly inside the replaced range survives", () => {
		const outcome = runC2Case(
			"abcd",
			{ at: 1, deleteLength: 2, insert: "X", startOffset: 1 },
			[{ at: 2, deleteLength: 0, insert: "Z" }],
		);
		expect(outcome.rebased).toBe("aZXd");
		expect(outcome.rebased).toBe(outcome.oracle);
		expect(outcome.validationErrors).toEqual([]);
	});

	it("C2: a remote insert at the replaced range's end stays outside the delete", () => {
		// The end-bias case: base `abc`, the IME replaces `b` with `X`, a peer
		// inserts `Z` after `b`. The old mapping swallowed `Z` (`aXc`).
		const outcome = runC2Case(
			"abc",
			{ at: 1, deleteLength: 1, insert: "X", startOffset: 1 },
			[{ at: 2, deleteLength: 0, insert: "Z" }],
		);
		expect(outcome.rebased).toContain("Z");
		expect(outcome.rebased).toBe("aZXc");
		expect(outcome.rebased).toBe(outcome.oracle);
	});

	it("C2: a remote insert at exactly the composition start lands before the composed text", () => {
		const fresh = runC2Case(
			"abc",
			{ at: 1, deleteLength: 0, insert: "X", startOffset: 1 },
			[{ at: 1, deleteLength: 0, insert: "Q" }],
		);
		expect(fresh.rebased).toBe("aQXbc");
		expect(fresh.rebased).toBe(fresh.oracle);
		const replacing = runC2Case(
			"abc",
			{ at: 1, deleteLength: 1, insert: "X", startOffset: 1 },
			[{ at: 1, deleteLength: 0, insert: "Q" }],
		);
		expect(replacing.rebased).toBe("aQXc");
		expect(replacing.rebased).toBe(replacing.oracle);
	});

	it("C2: an ambiguous diff anchors at the composition start offset", () => {
		// `aa` + `a` composed at 0: the prefix-greedy diff puts it at 2.
		expect(computeAnchoredTextDiff("aa", "aaa", 0)).toEqual([
			{ type: "insert", offset: 0, text: "a" },
		]);
		expect(computeAnchoredTextDiff("aa", "aaa", 1)).toEqual([
			{ type: "insert", offset: 1, text: "a" },
		]);
		const outcome = runC2Case(
			"aa",
			{ at: 0, deleteLength: 0, insert: "a", startOffset: 0 },
			[{ at: 1, deleteLength: 0, insert: "Z" }],
		);
		expect(outcome.rebased).toBe(outcome.oracle);
	});
});
