import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type {
	DocumentOp,
	Editor,
	SelectionRecord,
	SelectionRecordState,
} from "@input/pen-types";
import { createSelectionOverlayContributor } from "../selectionOverlay";
import type {
	OverlayFieldState,
	OverlayReadContext,
	OverlayRequest,
} from "../types";

const FIELD: OverlayFieldState = {
	isEditing: true,
	isFocused: true,
	isComposing: false,
	readonly: false,
	mode: "single",
	editingCell: false,
	substitute: null,
};

const MENTION = { nodeType: "mention", props: { id: "user-ada", label: "Ada" } };

/**
 * `p0` "Hello @Ada world" (atom at 6), `p1` "x @Ada@Bo y" (atoms at 2, 3),
 * `empty` (empty paragraph), `div` (divider), then `b0`…`b59` "text n".
 */
function createDocument(): Editor {
	const editor = createEditor({ schema: defaultSchema });
	const first = editor.firstBlock()!.id;
	const ops: DocumentOp[] = [
		{ type: "delete-block", blockId: first },
		insertBlock("p0", "paragraph"),
		splice("p0", 0, "Hello  world"),
		splice("p0", 6, MENTION),
		insertBlock("p1", "paragraph"),
		splice("p1", 0, "x  y"),
		splice("p1", 2, MENTION),
		splice("p1", 3, MENTION),
		insertBlock("empty", "paragraph"),
		insertBlock("div", "divider"),
	];
	for (let index = 0; index < 60; index += 1) {
		ops.push(insertBlock(`b${index}`, "paragraph"), splice(`b${index}`, 0, `text ${index}`));
	}
	editor.apply(ops, { origin: "system" });
	return editor;
}

function insertBlock(blockId: string, blockType: string): DocumentOp {
	return { type: "insert-block", blockId, blockType, props: {}, position: "last" };
}

function splice(
	blockId: string,
	at: number,
	insert: string | typeof MENTION,
): DocumentOp {
	return { type: "splice-text", blockId, from: at, to: at, insert } as DocumentOp;
}

function text(
	anchor: [string, number],
	focus: [string, number] = anchor,
	affinity: "upstream" | "downstream" = "downstream",
): SelectionRecordState {
	return {
		type: "text",
		anchor: { blockId: anchor[0], offset: anchor[1] },
		focus: { blockId: focus[0], offset: focus[1] },
		affinity,
		goalX: null,
	};
}

let version = 0;
let editor: Editor;

function requests(
	state: SelectionRecordState,
	patch: Omit<Partial<OverlayReadContext>, "field"> & {
		field?: Partial<OverlayFieldState>;
	} = {},
): readonly OverlayRequest[] {
	version += 1;
	const selection: SelectionRecord = {
		state,
		version,
		origin: "keyboard",
		commitId: 0,
	};
	return createSelectionOverlayContributor().requests({
		editor,
		commits: [],
		selection,
		caretMode: "auto",
		...patch,
		field: { ...FIELD, ...patch.field },
	});
}

function kinds(list: readonly OverlayRequest[]): string[] {
	return list.map((request) =>
		request.kind === "caret" ? `caret:${request.role}` : request.kind,
	);
}

function blockIds(from: number, to: number): string[] {
	const ids: string[] = [];
	for (let index = from; index <= to; index += 1) {
		ids.push(`b${index}`);
	}
	return ids;
}

afterEach(() => {
	editor?.destroy();
});

describe("local-selection contributor (§3.5)", () => {
	it("O1: a collapsed caret on either side of an inline atom requests one local caret", () => {
		editor = createDocument();
		for (const offset of [6, 7]) {
			expect(kinds(requests(text(["p0", offset])))).toEqual(["caret:local"]);
		}
		for (const offset of [2, 3, 4]) {
			expect(kinds(requests(text(["p1", offset])))).toEqual(["caret:local"]);
		}
		expect(requests(text(["p0", 2]))).toEqual([]);
		expect(requests(text(["p1", 0]))).toEqual([]);
	});

	it("O2: an empty text block requests a local caret; an empty divider does not", () => {
		editor = createDocument();
		expect(kinds(requests(text(["empty", 0])))).toEqual(["caret:local"]);
		expect(requests(text(["div", 0]))).toEqual([]);
	});

	it("O3: block selection requests one outline per block up to 50, then one span per contiguous run", () => {
		editor = createDocument();
		const fifty = requests({ type: "block", blockIds: blockIds(0, 49), head: "b49" });
		expect(fifty).toHaveLength(50);
		expect(new Set(kinds(fifty))).toEqual(new Set(["block-outline"]));

		const contiguous = requests({ type: "block", blockIds: blockIds(0, 50), head: "b50" });
		expect(contiguous).toEqual([
			{ kind: "block-span", key: "block-span:b0", fromBlockId: "b0", toBlockId: "b50" },
		]);

		const twoRuns = requests({
			type: "block",
			blockIds: [...blockIds(30, 59), ...blockIds(0, 24)],
			head: "b59",
		});
		expect(twoRuns.map((request) => request.kind === "block-span" && [request.fromBlockId, request.toBlockId])).toEqual([
			["b0", "b24"],
			["b30", "b59"],
		]);
	});

	it("O3: a grid cell selection requests one cell range; cell editing requests none", () => {
		editor = createDocument();
		const cell: SelectionRecordState = {
			type: "cell",
			blockId: "t1",
			anchor: { row: 0, col: 1 },
			head: { row: 2, col: 0 },
		};
		expect(requests(cell)).toEqual([
			{
				kind: "cell-range",
				key: "cell-range",
				blockId: "t1",
				anchor: { row: 0, col: 1 },
				head: { row: 2, col: 0 },
			},
		]);
		expect(requests(cell, { field: { editingCell: true } })).toEqual([]);
		expect(requests({ type: "app", appId: "a1" })).toEqual([]);
	});

	it("O4: a multi-block range requests endpoint carets only at endpoints meeting O1 or O2", () => {
		editor = createDocument();
		const intoEmpty = requests(text(["b0", 2], ["empty", 0]), {
			field: { mode: "expanded" },
		});
		expect(intoEmpty).toMatchObject([
			{ kind: "caret", role: "endpoint", endpoint: "focus", point: { blockId: "empty", offset: 0 } },
		]);
		expect(requests(text(["b0", 2], ["b3", 1]), { field: { mode: "expanded" } })).toEqual([]);
		expect(
			kinds(requests(text(["p0", 7], ["empty", 0]), { field: { mode: "expanded" } })),
		).toEqual(["caret:endpoint", "caret:endpoint"]);
	});

	it("O4: the S2-exception surface requests both endpoints, two partial ranges and one span", () => {
		editor = createDocument();
		const wide = requests(text(["b55", 2], ["b2", 3]), {
			field: { substitute: "block-surface-range", mode: "block", isEditing: false },
		});
		expect(kinds(wide)).toEqual([
			"caret:endpoint",
			"caret:endpoint",
			"range",
			"range",
			"block-span",
		]);
		expect(wide.slice(2)).toEqual([
			{
				kind: "range",
				key: "range:first",
				anchor: { blockId: "b2", offset: 3 },
				focus: { blockId: "b2", offset: 6 },
			},
			{
				kind: "range",
				key: "range:last",
				anchor: { blockId: "b55", offset: 0 },
				focus: { blockId: "b55", offset: 2 },
			},
			{ kind: "block-span", key: "range:covered", fromBlockId: "b3", toBlockId: "b54" },
		]);

		const confined = requests(text(["b0", 1], ["b1", 2]), {
			field: { substitute: "engine-confined-range" },
		});
		expect(kinds(confined)).toEqual([
			"caret:endpoint",
			"caret:endpoint",
			"range",
			"range",
		]);
	});

	it("O5: a read-only field requests no caret of any role, and still requests outlines", () => {
		editor = createDocument();
		const field = { readonly: true };
		expect(requests(text(["p0", 6]), { field })).toEqual([]);
		expect(requests(text(["p0", 6]), { field, caretMode: "all" })).toEqual([]);
		expect(requests(text(["b0", 2], ["empty", 0]), { field })).toEqual([]);
		expect(
			kinds(
				requests(text(["b55", 2], ["b2", 3]), {
					field: { ...field, substitute: "block-surface-range" },
				}),
			),
		).toEqual(["range", "range", "block-span"]);
		expect(
			kinds(requests({ type: "block", blockIds: ["b1", "b2"], head: "b2" }, { field })),
		).toEqual(["block-outline", "block-outline"]);
	});

	it("AX6: composing, unfocused or not-editing fields request no caret", () => {
		editor = createDocument();
		for (const field of [
			{ isComposing: true },
			{ isFocused: false },
			{ isEditing: false },
		]) {
			expect(requests(text(["p0", 6]), { field })).toEqual([]);
			expect(requests(text(["p0", 6]), { field, caretMode: "all" })).toEqual([]);
		}
	});

	it("G3: the local caret request carries the record's affinity", () => {
		editor = createDocument();
		const [request] = requests(text(["p0", 7], ["p0", 7], "upstream"));
		expect(request).toMatchObject({ kind: "caret", affinity: "upstream" });
	});

	it("O: customCaret mode requests a caret for every allowed collapsed caret", () => {
		editor = createDocument();
		expect(kinds(requests(text(["b0", 2]), { caretMode: "all" }))).toEqual(["caret:local"]);
		expect(requests(text(["b0", 1], ["b0", 4]), { caretMode: "all" })).toEqual([]);
		expect(requests(text(["p0", 2]), { field: { editingCell: true }, caretMode: "all" })).toEqual([]);
	});

	describe("caches follow the document, not only the selection version", () => {
		// Core does not bump the record version when a commit leaves the mapped
		// selection equal, so a remote edit inside a held range must still
		// refresh the D5 / O3 requests.
		function reader(
			state: SelectionRecordState,
			field: Partial<OverlayFieldState>,
		) {
			const contributor = createSelectionOverlayContributor();
			const selection: SelectionRecord = {
				state,
				version: 1,
				origin: "keyboard",
				commitId: 0,
			};
			return () =>
				contributor.requests({
					editor,
					commits: [],
					selection,
					caretMode: "auto",
					field: { ...FIELD, ...field },
				});
		}
		const surface = {
			substitute: "block-surface-range",
			mode: "block",
			isEditing: false,
		} as const;

		const insertAfterB2: DocumentOp = {
			type: "insert-block",
			blockId: "x",
			blockType: "paragraph",
			props: {},
			position: { after: "b2" },
		};
		it.each<[string, DocumentOp, Record<string, unknown>]>([
			[
				"a remote append to the first block extends range:first",
				splice("b2", 6, "!!"),
				{ key: "range:first", focus: { blockId: "b2", offset: 8 } },
			],
			[
				"a remote delete of the first covered block moves range:covered",
				{ type: "delete-block", blockId: "b3" },
				{ key: "range:covered", fromBlockId: "b4", toBlockId: "b54" },
			],
			[
				"a remote insert after the first block joins range:covered",
				insertAfterB2,
				{ key: "range:covered", fromBlockId: "x" },
			],
		])("S2: %s", (_name, op, expected) => {
			editor = createDocument();
			const read = reader(text(["b2", 3], ["b55", 2]), surface);
			read();
			editor.apply([op], { origin: "collaborator" });
			expect(read()).toContainEqual(expect.objectContaining(expected));
		});

		it("O3: a remote insert inside a selected run splits the span", () => {
			editor = createDocument();
			const read = reader(
				{ type: "block", blockIds: blockIds(0, 59), head: "b59" },
				{},
			);
			expect(read()).toHaveLength(1);
			editor.apply(
				[
					{
						type: "insert-block",
						blockId: "x",
						blockType: "paragraph",
						props: {},
						position: { after: "b10" },
					},
				],
				{ origin: "collaborator" },
			);
			expect(read()).toEqual([
				{
					kind: "block-span",
					key: "block-span:b0",
					fromBlockId: "b0",
					toBlockId: "b10",
				},
				{
					kind: "block-span",
					key: "block-span:b11",
					fromBlockId: "b11",
					toBlockId: "b59",
				},
			]);
		});

		it("an unchanged document reuses the cached requests", () => {
			editor = createDocument();
			const read = reader(text(["b2", 3], ["b55", 2]), surface);
			const first = read();
			const ranges = first.filter((request) => request.kind !== "caret");
			expect(
				read().filter((request) => request.kind !== "caret"),
			).toEqual(ranges);
			const second = read();
			expect(second[2]).toBe(first[2]);
		});
	});
});
