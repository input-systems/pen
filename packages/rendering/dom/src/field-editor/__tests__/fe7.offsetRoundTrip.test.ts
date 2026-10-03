// @vitest-environment jsdom

import { createHeadlessEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { createInlineAtomElement } from "../inlineAtomDom";
import { getCaretOffset, getSelectionOffsets } from "../selectionReader";
import { writeNativeRange } from "../selectionProjector";
import { findLogicalDOMPoint } from "../inlineAtomLogicalDom";

const BLOCK_ID = "block-1";

/**
 * FE7 corpus. Each case is the inline content of one block, described as the
 * runs the reconciler would render: strings are text runs, `atom` marks an
 * inline atom (one model offset wide).
 */
type Run = string | { atom: string };

const CORPUS: ReadonlyArray<{ name: string; runs: readonly Run[] }> = [
	{ name: "ascii", runs: ["Hello world"] },
	{ name: "empty", runs: [""] },
	{ name: "single character", runs: ["x"] },
	// Mark boundaries split one logical string across sibling text nodes.
	{ name: "split text runs", runs: ["Hello", " ", "world"] },
	{ name: "astral pair", runs: ["a\u{1F600}b"] },
	{ name: "combining mark", runs: ["cafe\u0301 au lait"] },
	{ name: "zwj family", runs: ["x\u{1F468}\u200D\u{1F469}\u200D\u{1F467}y"] },
	{ name: "regional indicators", runs: ["\u{1F1F3}\u{1F1F1}"] },
	{ name: "atom alone", runs: [{ atom: "mention" }] },
	{ name: "atom at start", runs: [{ atom: "mention" }, "after"] },
	{ name: "atom at end", runs: ["before", { atom: "mention" }] },
	{
		name: "atom between text",
		runs: ["before", { atom: "mention" }, "after"],
	},
	{
		name: "adjacent atoms",
		runs: ["a", { atom: "mention" }, { atom: "mention" }, "b"],
	},
	{
		name: "atom beside astral pair",
		runs: ["\u{1F600}", { atom: "mention" }, "\u{1F600}"],
	},
];

const editors: Array<ReturnType<typeof createHeadlessEditor>> = [];
const roots: HTMLElement[] = [];

afterEach(() => {
	while (roots.length > 0) {
		roots.pop()?.remove();
	}
	while (editors.length > 0) {
		void editors.pop()?.destroy();
	}
	document.body.replaceChildren();
});

function mount(runs: readonly Run[]): {
	root: HTMLElement;
	inline: HTMLElement;
	length: number;
} {
	const editor = createHeadlessEditor({ schema: defaultSchema });
	editors.push(editor);

	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, BLOCK_ID);
	const inline = document.createElement("span");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");

	let length = 0;
	for (const run of runs) {
		if (typeof run === "string") {
			if (run.length > 0) {
				inline.append(document.createTextNode(run));
			}
			length += run.length;
			continue;
		}
		inline.append(
			createInlineAtomElement(
				{ type: run.atom, props: { id: "1", label: "Ada" } },
				editor.schema,
			),
		);
		length += 1;
	}

	block.append(inline);
	root.append(block);
	document.body.append(root);
	roots.push(root);
	return { root, inline, length };
}

describe("FE7 offset bridge round-trips", () => {
	for (const { name, runs } of CORPUS) {
		it(`model → DOM → model is identity: ${name}`, () => {
			const { root, inline, length } = mount(runs);

			const readBack: number[] = [];
			for (let offset = 0; offset <= length; offset += 1) {
				writeNativeRange(
					root,
					{ blockId: BLOCK_ID, offset },
					{ blockId: BLOCK_ID, offset },
				);
				readBack.push(getCaretOffset(inline));
			}

			expect(readBack).toEqual(
				Array.from({ length: length + 1 }, (_, offset) => offset),
			);
		});

		it(`DOM → model → DOM lands in the same place: ${name}`, () => {
			const { root, inline, length } = mount(runs);

			for (let offset = 0; offset <= length; offset += 1) {
				const first = findLogicalDOMPoint(inline, offset);
				writeNativeRange(
					root,
					{ blockId: BLOCK_ID, offset },
					{ blockId: BLOCK_ID, offset },
				);
				const second = findLogicalDOMPoint(
					inline,
					getCaretOffset(inline),
				);

				expect(
					{ node: second.node, offset: second.offset },
					`offset ${offset} of ${length} must resolve to one DOM point`,
				).toEqual({ node: first.node, offset: first.offset });
			}
		});
	}

	it("maps every offset of a selection range, not just its ends", () => {
		const { root, inline } = mount([
			"before",
			{ atom: "mention" },
			"after",
		]);

		writeNativeRange(
			root,
			{ blockId: BLOCK_ID, offset: 2 },
			{ blockId: BLOCK_ID, offset: 9 },
		);
		const selection = window.getSelection();

		expect(selection?.isCollapsed).toBe(false);
		expect(getSelectionOffsets(inline)).toEqual({ start: 2, end: 9 });
	});

	it("clamps an offset past the end to the end", () => {
		const { root, inline, length } = mount(["Hello"]);

		writeNativeRange(
			root,
			{ blockId: BLOCK_ID, offset: length + 5 },
			{ blockId: BLOCK_ID, offset: length + 5 },
		);

		expect(getCaretOffset(inline)).toBe(length);
	});
});
