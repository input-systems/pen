import { describe, expect, it } from "vitest";
import { computeAnchoredTextDiff } from "../textDiff";
import { runC2Case } from "./c2RebaseHarness";

/** C2 (D3) fixed cases. Each oracle is two converged `Y.Doc`s, remote first. */
describe("C2 rebaseTextDiffOps", () => {
	it.each([
		["a remote insert strictly inside the replaced range survives", "abcd", 1, 2, 2, "aZXd"],
		// The end-bias case: base `abc`, the IME replaces `b` with `X`, a peer
		// inserts `Z` after `b`. The old mapping swallowed `Z` (`aXc`).
		["a remote insert at the replaced range's end stays outside the delete", "abc", 1, 1, 2, "aZXc"],
		["a remote insert at exactly the composition start lands before fresh composed text", "abc", 1, 0, 1, "aZXbc"],
		["a remote insert at exactly the composition start lands before replacing composed text", "abc", 1, 1, 1, "aZXc"],
	])("C2: %s", (_name, base, at, deleteLength, remoteAt, expected) => {
		const outcome = runC2Case(
			base,
			{ at, deleteLength, insert: "X", startOffset: at },
			[{ at: remoteAt, deleteLength: 0, insert: "Z" }],
		);
		expect(outcome.rebased).toBe(expected);
		expect(outcome.rebased).toBe(outcome.oracle);
		expect(outcome.validationErrors).toEqual([]);
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
