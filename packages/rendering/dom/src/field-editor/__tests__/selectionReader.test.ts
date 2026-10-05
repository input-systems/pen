import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { describe, expect, it } from "vitest";
import {
	CLOSED_GESTURE_WINDOWS,
	classifyDomSelectionRead,
	isAdmissibleDomRead,
	isLogicallyEquivalent,
	nextGestureWindowState,
	normalizeDomSelectionProposal,
	originForGestureWindows,
	decideDomSelectionRead,
	type GestureWindowState,
	type ReaderSelection,
	type ReaderSnapshot,
} from "../selectionReader";

function textSelection(
	anchor: { blockId: string; offset: number },
	focus: { blockId: string; offset: number } = anchor,
): ReaderSelection {
	return { type: "text", anchor, focus };
}

function blockSelection(
	blockIds: readonly string[],
	head?: string,
): ReaderSelection {
	if (head === undefined) {
		return { type: "block", blockIds };
	}
	return { type: "block", blockIds, head };
}

describe("isLogicallyEquivalent", () => {
	it("S2 N2: a text range ending on a structural block's 0..1 extent is equivalent to itself", () => {
		const snapshot: ReaderSnapshot = {
			blockOrder: ["p1", "image"],
			blocks: {
				p1: { kind: "text", text: "Before" },
				image: { kind: "structural", text: "" },
			},
		};
		const range = textSelection(
			{ blockId: "p1", offset: 3 },
			{ blockId: "image", offset: 1 },
		);
		expect(isLogicallyEquivalent(range, range, snapshot)).toBe(true);
		expect(
			isLogicallyEquivalent(
				range,
				textSelection(
					{ blockId: "p1", offset: 3 },
					{ blockId: "image", offset: 0 },
				),
				snapshot,
			),
		).toBe(false);
	});

	describe("empty block", () => {
		const snapshot: ReaderSnapshot = {
			blockOrder: ["empty"],
			blocks: {
				empty: { kind: "text", text: "" },
			},
		};
		const authority = textSelection({ blockId: "empty", offset: 0 });

		it("E2 §2: DOM offset 1 in a sentinel-only block equals authority 0", () => {
			expect(
				isLogicallyEquivalent(
					textSelection({ blockId: "empty", offset: 1 }),
					authority,
					snapshot,
				),
			).toBe(true);
		});

		it("E2 §2: DOM offset 0 in a sentinel-only block equals authority 0", () => {
			expect(isLogicallyEquivalent(authority, authority, snapshot)).toBe(
				true,
			);
		});

		it("E2 §2: a caret on a different empty-block id is not equivalent", () => {
			const other: ReaderSnapshot = {
				blockOrder: ["empty", "other"],
				blocks: {
					empty: { kind: "text", text: "" },
					other: { kind: "text", text: "" },
				},
			};
			expect(
				isLogicallyEquivalent(
					textSelection({ blockId: "other", offset: 1 }),
					authority,
					other,
				),
			).toBe(false);
		});
	});

	describe("inline atom", () => {
		const snapshot: ReaderSnapshot = {
			blockOrder: ["embed"],
			blocks: {
				embed: {
					kind: "text",
					text: "hello",
					atoms: [{ start: 1, end: 4 }],
				},
			},
		};
		const beforeAtom = textSelection({ blockId: "embed", offset: 1 });
		const afterAtom = textSelection({ blockId: "embed", offset: 4 });

		it("E2 N1: the same atom side is equivalent", () => {
			expect(
				isLogicallyEquivalent(beforeAtom, beforeAtom, snapshot),
			).toBe(true);
			expect(isLogicallyEquivalent(afterAtom, afterAtom, snapshot)).toBe(
				true,
			);
		});

		it("E2 N1: opposite atom sides are not equivalent", () => {
			expect(isLogicallyEquivalent(beforeAtom, afterAtom, snapshot)).toBe(
				false,
			);
			expect(isLogicallyEquivalent(afterAtom, beforeAtom, snapshot)).toBe(
				false,
			);
		});

		it("E2 N1: an interior offset is equivalent to either atom side", () => {
			const interior = textSelection({ blockId: "embed", offset: 2 });
			expect(isLogicallyEquivalent(interior, afterAtom, snapshot)).toBe(
				true,
			);
			expect(isLogicallyEquivalent(interior, beforeAtom, snapshot)).toBe(
				true,
			);
		});

		it("E2 N1: an interior offset is not equivalent to a caret off the atom", () => {
			const interior = textSelection({ blockId: "embed", offset: 2 });
			expect(
				isLogicallyEquivalent(
					interior,
					textSelection({ blockId: "embed", offset: 0 }),
					snapshot,
				),
			).toBe(false);
		});
	});

	describe("block selection", () => {
		const snapshot: ReaderSnapshot = {
			blockOrder: ["p1", "p2", "p3"],
			blocks: {
				p1: { kind: "text", text: "a" },
				p2: { kind: "text", text: "b" },
				p3: { kind: "text", text: "c" },
			},
		};

		it("E2 A2: the same block ids and head are equivalent", () => {
			const selection = blockSelection(["p1", "p2"], "p2");
			expect(isLogicallyEquivalent(selection, selection, snapshot)).toBe(
				true,
			);
		});

		it("E2 A2: the same block ids with a different head are not equivalent", () => {
			expect(
				isLogicallyEquivalent(
					blockSelection(["p1", "p2"], "p1"),
					blockSelection(["p1", "p2"], "p2"),
					snapshot,
				),
			).toBe(false);
		});

		it("E2 A2: a missing head defaults to the last block id", () => {
			expect(
				isLogicallyEquivalent(
					blockSelection(["p1", "p2"]),
					blockSelection(["p1", "p2"], "p2"),
					snapshot,
				),
			).toBe(true);
			expect(
				isLogicallyEquivalent(
					blockSelection(["p1", "p2"]),
					blockSelection(["p1", "p2"], "p1"),
					snapshot,
				),
			).toBe(false);
		});

		it("E2 A2: a missing head on one block defaults to that id", () => {
			expect(
				isLogicallyEquivalent(
					blockSelection(["p1"]),
					blockSelection(["p1"], "p1"),
					snapshot,
				),
			).toBe(true);
		});
	});

	describe("multi-block range", () => {
		const snapshot: ReaderSnapshot = {
			blockOrder: ["p1", "p2", "p3"],
			blocks: {
				p1: { kind: "text", text: "alpha" },
				p2: { kind: "text", text: "bravo" },
				p3: { kind: "text", text: "charlie" },
			},
		};
		const range = textSelection(
			{ blockId: "p1", offset: 0 },
			{ blockId: "p2", offset: 5 },
		);

		it("E2 §4.2: the same multi-block range is equivalent", () => {
			expect(isLogicallyEquivalent(range, range, snapshot)).toBe(true);
		});

		it("E2 §4.2: a leftover single-block range is not equivalent", () => {
			expect(
				isLogicallyEquivalent(
					textSelection(
						{ blockId: "p1", offset: 0 },
						{ blockId: "p1", offset: 5 },
					),
					range,
					snapshot,
				),
			).toBe(false);
		});

		it("E2 §4.2: a reversed multi-block range is not equivalent", () => {
			expect(
				isLogicallyEquivalent(
					textSelection(
						{ blockId: "p2", offset: 5 },
						{ blockId: "p1", offset: 0 },
					),
					range,
					snapshot,
				),
			).toBe(false);
		});

		it("E2 §4.2: a wider p1–p3 range is not equivalent", () => {
			expect(
				isLogicallyEquivalent(
					textSelection(
						{ blockId: "p1", offset: 0 },
						{ blockId: "p3", offset: 7 },
					),
					range,
					snapshot,
				),
			).toBe(false);
		});
	});

	it("E2: null matches only null", () => {
		const snapshot: ReaderSnapshot = {
			blockOrder: ["p1"],
			blocks: { p1: { kind: "text", text: "x" } },
		};
		expect(isLogicallyEquivalent(null, null, snapshot)).toBe(true);
		expect(
			isLogicallyEquivalent(
				textSelection({ blockId: "p1", offset: 0 }),
				null,
				snapshot,
			),
		).toBe(false);
	});
});

describe("classifyDomSelectionRead §4.2 steps 2–5", () => {
	const snapshot: ReaderSnapshot = {
		blockOrder: ["p1"],
		blocks: { p1: { kind: "text", text: "hello" } },
	};
	const caret = textSelection({ blockId: "p1", offset: 0 });
	const moved = textSelection({ blockId: "p1", offset: 2 });

	it("step 2: an unresolvable DOM read produces no proposal", () => {
		expect(
			classifyDomSelectionRead({
				proposal: null,
				authorityState: caret,
				snapshot,
				gestureWindows: CLOSED_GESTURE_WINDOWS,
			}),
		).toBe("no-proposal");
	});

	it("step 3: an equivalent proposal stops", () => {
		expect(
			classifyDomSelectionRead({
				proposal: caret,
				authorityState: caret,
				snapshot,
				gestureWindows: CLOSED_GESTURE_WINDOWS,
			}),
		).toBe("equivalent");
	});

	it("step 3: a real move is not equivalent", () => {
		expect(
			classifyDomSelectionRead({
				proposal: moved,
				authorityState: caret,
				snapshot,
				gestureWindows: CLOSED_GESTURE_WINDOWS,
			}),
		).toBe("diverge");
	});

	it("step 3: an interior atom read is equivalent to a before-side authority", () => {
		const atomSnapshot: ReaderSnapshot = {
			blockOrder: ["embed"],
			blocks: {
				embed: {
					kind: "text",
					text: "hello",
					atoms: [{ start: 1, end: 4 }],
				},
			},
		};
		expect(
			classifyDomSelectionRead({
				proposal: textSelection({ blockId: "embed", offset: 2 }),
				authorityState: textSelection({ blockId: "embed", offset: 1 }),
				snapshot: atomSnapshot,
				gestureWindows: CLOSED_GESTURE_WINDOWS,
			}),
		).toBe("equivalent");
	});

	it("step 3: the same block ids with a different head are not equivalent", () => {
		const blockSnapshot: ReaderSnapshot = {
			blockOrder: ["p1", "p2"],
			blocks: {
				p1: { kind: "text", text: "a" },
				p2: { kind: "text", text: "b" },
			},
		};
		expect(
			classifyDomSelectionRead({
				proposal: blockSelection(["p1", "p2"], "p1"),
				authorityState: blockSelection(["p1", "p2"], "p2"),
				snapshot: blockSnapshot,
				gestureWindows: CLOSED_GESTURE_WINDOWS,
			}),
		).toBe("diverge");
	});
});

describe("classifyDomSelectionRead §4.2 steps 4–5", () => {
	const snapshot: ReaderSnapshot = {
		blockOrder: ["p1", "p2"],
		blocks: {
			p1: { kind: "text", text: "hello" },
			p2: { kind: "text", text: "world" },
		},
	};
	const caret = textSelection({ blockId: "p1", offset: 0 });
	const moved = textSelection({ blockId: "p1", offset: 2 });

	it("step 4: a closed window rejects the proposal and requests P2", () => {
		expect(
			classifyDomSelectionRead({
				proposal: moved,
				authorityState: caret,
				snapshot,
				gestureWindows: CLOSED_GESTURE_WINDOWS,
			}),
		).toBe("diverge");
	});

	it.each([
		["pointer", "pointerdown"],
		["ime", "compositionstart"],
		["context-menu", "contextmenu"],
		["drag", "dragstart"],
	] as const)(
		"step 5: an open %s window accepts the proposal",
		(_window, event) => {
			expect(
				classifyDomSelectionRead({
					proposal: moved,
					authorityState: caret,
					snapshot,
					gestureWindows: nextGestureWindowState(
						event,
						CLOSED_GESTURE_WINDOWS,
					),
				}),
			).toBe("accept");
		},
	);

	it("step 4: keyboard events do not make a later selectionchange admissible", () => {
		const afterKeys = nextGestureWindowState(
			"keyup",
			nextGestureWindowState("keydown", CLOSED_GESTURE_WINDOWS),
		);
		expect(
			classifyDomSelectionRead({
				proposal: moved,
				authorityState: caret,
				snapshot,
				gestureWindows: afterKeys,
			}),
		).toBe("diverge");
	});

	it("step 3 still wins over an open window", () => {
		expect(
			classifyDomSelectionRead({
				proposal: caret,
				authorityState: caret,
				snapshot,
				gestureWindows: nextGestureWindowState(
					"pointerdown",
					CLOSED_GESTURE_WINDOWS,
				),
			}),
		).toBe("equivalent");
	});

	it("R3: overlapping ime+pointer is admissible", () => {
		const overlapping = nextGestureWindowState(
			"pointerdown",
			nextGestureWindowState("compositionstart", CLOSED_GESTURE_WINDOWS),
		);
		expect(overlapping.ime).toBe(true);
		expect(overlapping.pointer).toBe(true);
		expect(
			classifyDomSelectionRead({
				proposal: moved,
				authorityState: caret,
				snapshot,
				gestureWindows: overlapping,
			}),
		).toBe("accept");
	});
});

describe("originForGestureWindows", () => {
	it("is ime whenever the ime window is open", () => {
		const ime = nextGestureWindowState(
			"compositionstart",
			CLOSED_GESTURE_WINDOWS,
		);
		expect(originForGestureWindows(ime)).toBe("ime");
		expect(
			originForGestureWindows(nextGestureWindowState("pointerdown", ime)),
		).toBe("ime");
	});

	it("is pointer for pointer, drag, and context-menu", () => {
		expect(
			originForGestureWindows(
				nextGestureWindowState("pointerdown", CLOSED_GESTURE_WINDOWS),
			),
		).toBe("pointer");
		expect(
			originForGestureWindows(
				nextGestureWindowState("dragstart", CLOSED_GESTURE_WINDOWS),
			),
		).toBe("pointer");
		expect(
			originForGestureWindows(
				nextGestureWindowState("contextmenu", CLOSED_GESTURE_WINDOWS),
			),
		).toBe("pointer");
	});
});

describe("normalizeDomSelectionProposal", () => {
	const snapshot: ReaderSnapshot = {
		blockOrder: ["p1", "divider"],
		blocks: {
			p1: { kind: "text", text: "hello" },
			divider: { kind: "structural", text: "" },
		},
	};

	it("snaps an interior atom point with dir 1 by default", () => {
		const atomSnapshot: ReaderSnapshot = {
			blockOrder: ["embed"],
			blocks: {
				embed: {
					kind: "text",
					text: "hello",
					atoms: [{ start: 1, end: 4 }],
				},
			},
		};
		expect(
			normalizeDomSelectionProposal(
				textSelection({ blockId: "embed", offset: 2 }),
				atomSnapshot,
			),
		).toEqual(textSelection({ blockId: "embed", offset: 4 }));
	});

	it("does not escalate a mixed text/structural range to BlockSelection", () => {
		const mixed = textSelection(
			{ blockId: "p1", offset: 2 },
			{ blockId: "divider", offset: 1 },
		);
		expect(normalizeDomSelectionProposal(mixed, snapshot)).toEqual(mixed);
	});
});

describe("decideDomSelectionRead §4.2 steps 4–5", () => {
	/** An editor whose first block reads "hello", caret at 0. */
	function helloEditor() {
		const editor = createEditor({ schema: defaultSchema });
		const id = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId: id,
				from: 0,
				to: 0,
				insert: "hello",
			},
		]);
		editor.selectText(id, 0, 0);
		return { editor, id };
	}

	it("step 4: a closed window does not normalize or accept", () => {
		const { editor, id } = helloEditor();
		const decided = decideDomSelectionRead({
			editor,
			proposal: textSelection({ blockId: id, offset: 2 }),
			gestureWindows: CLOSED_GESTURE_WINDOWS,
		});
		expect(decided.decision).toBe("diverge");
		expect(decided.normalized).toBeNull();
		void editor.destroy();
	});

	it("step 5: an open pointer window normalizes and accepts with origin pointer", () => {
		const { editor, id } = helloEditor();
		const decided = decideDomSelectionRead({
			editor,
			proposal: textSelection({ blockId: id, offset: 2 }),
			gestureWindows: nextGestureWindowState(
				"pointerdown",
				CLOSED_GESTURE_WINDOWS,
			),
		});
		expect(decided.decision).toBe("accept");
		expect(decided.origin).toBe("pointer");
		expect(decided.normalized).toEqual(
			textSelection({ blockId: id, offset: 2 }),
		);
		void editor.destroy();
	});

	it("step 5: overlapping ime+pointer accepts with origin ime", () => {
		const { editor, id } = helloEditor();
		const overlapping = nextGestureWindowState(
			"pointerdown",
			nextGestureWindowState("compositionstart", CLOSED_GESTURE_WINDOWS),
		);
		const decided = decideDomSelectionRead({
			editor,
			proposal: textSelection({ blockId: id, offset: 2 }),
			gestureWindows: overlapping,
		});
		expect(decided.decision).toBe("accept");
		expect(decided.origin).toBe("ime");
		void editor.destroy();
	});

	it("step 5: a same-ids block proposal without head keeps the authority head", () => {
		const editor = createEditor({ schema: defaultSchema });
		const first = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "insert-block",
				blockId: "second",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		editor.setSelection({
			type: "block",
			blockIds: [first, "second"],
			head: first,
		});
		const decided = decideDomSelectionRead({
			editor,
			proposal: blockSelection([first, "second"]),
			gestureWindows: nextGestureWindowState(
				"pointerdown",
				CLOSED_GESTURE_WINDOWS,
			),
		});
		expect(decided.decision).toBe("accept");
		expect(decided.normalized).toEqual(
			blockSelection([first, "second"], first),
		);
		void editor.destroy();
	});
});

describe("gesture windows §4.1", () => {
	function apply(
		eventKind: Parameters<typeof nextGestureWindowState>[0],
		state: GestureWindowState = CLOSED_GESTURE_WINDOWS,
	): GestureWindowState {
		return nextGestureWindowState(eventKind, state);
	}

	describe("pointer", () => {
		it("opens on pointerdown and admits the following selectionchange", () => {
			const state = apply("pointerdown");
			expect(state.pointer).toBe(true);
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(true);
		});

		it("does not close on pointerup", () => {
			const state = apply("pointerup", apply("pointerdown"));
			expect(state.pointer).toBe(true);
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(true);
		});

		it("closes on pointer-settled after pointerup", () => {
			const state = apply(
				"pointer-settled",
				apply("pointerup", apply("pointerdown")),
			);
			expect(state.pointer).toBe(false);
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(false);
		});
	});

	describe("ime", () => {
		it("opens on compositionstart and admits selectionchange", () => {
			const state = apply("compositionstart");
			expect(state.ime).toBe(true);
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(true);
		});

		it("stays open across keydown during composition", () => {
			const state = apply("keydown", apply("compositionstart"));
			expect(state.ime).toBe(true);
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(true);
		});

		it("closes when compositionend handling is completed", () => {
			const state = apply(
				"compositionend-completed",
				apply("compositionstart"),
			);
			expect(state.ime).toBe(false);
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(false);
		});
	});

	describe("context-menu", () => {
		it("opens on contextmenu and admits the next selectionchange", () => {
			const state = apply("contextmenu");
			expect(state.contextMenu).toBe(true);
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(true);
		});

		it("closes on that selectionchange so a later read is rejected", () => {
			const during = apply("contextmenu");
			expect(isAdmissibleDomRead("selectionchange", during)).toBe(true);
			const after = apply("selectionchange", during);
			expect(after.contextMenu).toBe(false);
			expect(isAdmissibleDomRead("selectionchange", after)).toBe(false);
		});
	});

	describe("drag", () => {
		it("opens on dragstart and admits selectionchange", () => {
			const state = apply("dragstart");
			expect(state.drag).toBe(true);
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(true);
		});

		it("closes on drop-completed and on dragend-completed", () => {
			expect(apply("drop-completed", apply("dragstart")).drag).toBe(
				false,
			);
			expect(apply("dragend-completed", apply("dragstart")).drag).toBe(
				false,
			);
		});
	});

	describe("keyboard", () => {
		it("does not open a window on keydown or keyup", () => {
			expect(apply("keydown")).toEqual(CLOSED_GESTURE_WINDOWS);
			expect(apply("keyup")).toEqual(CLOSED_GESTURE_WINDOWS);
		});

		it("rejects a selectionchange after only keyboard events", () => {
			const state = apply("keyup", apply("keydown"));
			expect(isAdmissibleDomRead("selectionchange", state)).toBe(false);
		});

		it("never treats keydown itself as an admissible DOM read", () => {
			expect(isAdmissibleDomRead("keydown", apply("pointerdown"))).toBe(
				false,
			);
		});
	});

	it("rejects a selectionchange when every window is closed", () => {
		expect(
			isAdmissibleDomRead("selectionchange", CLOSED_GESTURE_WINDOWS),
		).toBe(false);
	});
});
