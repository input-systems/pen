import { beforeEach, describe, expect, it } from "vitest";
import {
	COL4_DEFAULT_SCHEDULES,
	COL4_FUZZ_STRUCTURAL_KINDS,
	COL4_PEER_SCENARIOS,
	COL4_PEER_SIZES,
	expectedSplitSameOffsetTexts,
	runCol4PeerFuzz,
	runCol4PeerScenarioCase,
	col4SplitSameOffset,
} from "../col4Scenarios";
import { describePeerSchedule } from "../peerHarness";
import { collectInlineText, resetTestIdCounter, runPeerSchedules } from "../index";

beforeEach(() => {
	resetTestIdCounter();
});

const CASES = COL4_PEER_SCENARIOS.flatMap((scenario) =>
	(scenario.sizes ?? COL4_PEER_SIZES).flatMap((n) =>
		COL4_DEFAULT_SCHEDULES.map(
			(schedule) =>
				[scenario.name, n, describePeerSchedule(schedule), scenario, schedule] as const,
		),
	),
);

describe("COL4 at n peers", () => {
	it.each(CASES)(
		"COL4: %s converges at %i peers under %s",
		(_name, n, _label, scenario, schedule) => {
			runCol4PeerScenarioCase(scenario, n, schedule);
		},
	);

	it("COL4: concurrent splits carry one tail copy per splitter", () => {
		expect(expectedSplitSameOffsetTexts(2)).toEqual(["Hello", "World", "World"]);
		for (const n of COL4_PEER_SIZES) {
			const observed: string[][] = [];
			runPeerSchedules(
				n,
				col4SplitSameOffset.options(n),
				col4SplitSameOffset.apply,
				(harness) => {
					for (const peer of harness.peers) {
						observed.push(collectInlineText(peer.editor));
					}
				},
				["pairwise"],
			);
			const expected = ["Hello", ...Array.from({ length: n }, () => "World")];
			expect(observed).toEqual(Array.from({ length: n }, () => expected));
		}
	});

	it("COL4: seeded structural op sets keep every invariant at three peers", () => {
		const histogram = runCol4PeerFuzz({ peers: 3, iterations: 64, seed: 20261002 });
		for (const kind of COL4_FUZZ_STRUCTURAL_KINDS) {
			expect(histogram.get(kind) ?? 0, `fuzz emitted no ${kind}`).toBeGreaterThan(0);
		}
	});
});
