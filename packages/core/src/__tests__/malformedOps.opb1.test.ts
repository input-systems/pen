import { yjsAdapter } from "@input/pen-yjs";
import type { DiagnosticEvent, DocumentOp } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createEditor as createCoreEditor } from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";
import { noDefaultExtensionsPreset } from "./ops.testHelpers";

// OPB1. Op payloads land in the CRDT verbatim, so a value the CRDT cannot
// encode passes the write and fails the next `encodeStateAsUpdate`, after
// which the document can neither sync nor persist. Validate drops such ops
// with PEN_APPLY_004 instead.

const MALFORMED_CODE = "PEN_APPLY_004";

function createPeer() {
	const adapter = yjsAdapter();
	const editor = createCoreEditor({
		schema: createDefaultSchema(),
		crdt: adapter,
		preset: noDefaultExtensionsPreset,
	});
	const ydoc = adapter.raw<Y.Doc>(editor.internals.crdtDoc);
	const diagnostics: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => {
		diagnostics.push(event);
	});
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello" },
	]);
	return { editor, ydoc, diagnostics, blockId };
}

function cyclic(): Record<string, unknown> {
	const value: Record<string, unknown> = { a: 1 };
	value.self = value;
	return value;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("OPB1: validate rejects payloads the CRDT cannot encode", () => {
	it.each([
		["missing", undefined],
		["empty", ""],
		["numeric", 7],
		["array", ["ns"]],
		["symbol", Symbol("ns")],
	])(
		"OPB1: set-meta with a %s namespace is dropped and the document still encodes",
		(_label, namespace) => {
			const { editor, ydoc, diagnostics, blockId } = createPeer();

			expect(() => {
				editor.apply([
					{
						type: "set-meta",
						blockId,
						namespace,
						data: { reviewed: true },
					} as unknown as DocumentOp,
				]);
			}).not.toThrow();

			expect(diagnostics).toContainEqual(
				expect.objectContaining({
					code: MALFORMED_CODE,
					message: "set-meta requires a non-empty string namespace",
				}),
			);
			expect(() => Y.encodeStateAsUpdate(ydoc)).not.toThrow();
			const meta = ydoc
				.getMap<Y.Map<unknown>>("blocks")
				.get(blockId)!
				.get("meta") as Y.Map<unknown> | undefined;
			expect(meta === undefined || meta.size === 0).toBe(true);

			editor.destroy();
		},
	);

	it("OPB1: a well-formed set-meta still writes its namespace", () => {
		const { editor, ydoc, diagnostics, blockId } = createPeer();

		editor.apply([
			{
				type: "set-meta",
				blockId,
				namespace: "review",
				data: { ok: true },
			},
		]);

		expect(diagnostics.filter((d) => d.code === MALFORMED_CODE)).toEqual(
			[],
		);
		const meta = ydoc
			.getMap<Y.Map<unknown>>("blocks")
			.get(blockId)!
			.get("meta") as Y.Map<unknown>;
		expect(meta.get("review")).toEqual({ ok: true });
		expect(() => Y.encodeStateAsUpdate(ydoc)).not.toThrow();

		editor.destroy();
	});

	it.each<[string, (blockId: string) => unknown]>([
		[
			"set-meta cyclic data",
			(blockId) => ({
				type: "set-meta",
				blockId,
				namespace: "n",
				data: cyclic(),
			}),
		],
		[
			"set-meta non-object data",
			(blockId) => ({
				type: "set-meta",
				blockId,
				namespace: "n",
				data: "x",
			}),
		],
		[
			"set-props cyclic value",
			(blockId) => ({
				type: "set-props",
				blockId,
				props: { k: cyclic() },
			}),
		],
		[
			"set-props null props",
			(blockId) => ({ type: "set-props", blockId, props: null }),
		],
		[
			"insert-block missing props",
			() => ({
				type: "insert-block",
				blockId: "fresh",
				blockType: "paragraph",
				position: "last",
			}),
		],
		[
			"insert-block cyclic prop",
			() => ({
				type: "insert-block",
				blockId: "fresh",
				blockType: "paragraph",
				props: { k: cyclic() },
				position: "last",
			}),
		],
		[
			"insert-block null position",
			() => ({
				type: "insert-block",
				blockId: "fresh",
				blockType: "paragraph",
				props: {},
				position: null,
			}),
		],
		[
			"move-block null position",
			(blockId) => ({ type: "move-block", blockId, position: null }),
		],
		[
			"splice-text undefined mark value",
			(blockId) => ({
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "x",
				marks: { bold: undefined },
			}),
		],
		[
			"splice-text bigint mark value",
			(blockId) => ({
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "x",
				marks: { bold: 1n },
			}),
		],
		[
			"splice-text atom with cyclic props",
			(blockId) => ({
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: { nodeType: "mention", props: cyclic() },
			}),
		],
		[
			"format-text undefined mark value",
			(blockId) => ({
				type: "format-text",
				blockId,
				from: 0,
				to: 2,
				marks: { bold: undefined },
			}),
		],
		[
			"format-text cyclic mark value",
			(blockId) => ({
				type: "format-text",
				blockId,
				from: 0,
				to: 2,
				marks: { bold: cyclic() },
			}),
		],
		[
			"app create cyclic config",
			() => ({
				type: "app",
				change: {
					kind: "create",
					appId: "a",
					appType: "t",
					config: { c: cyclic() },
					placement: { mode: "inline", blockId: "x", index: 0 },
				},
			}),
		],
		[
			"app update missing patch",
			() => ({ type: "app", change: { kind: "update", appId: "a" } }),
		],
		["null op", () => null],
	])(
		"OPB1: %s is dropped with PEN_APPLY_004 and the document still encodes",
		(_label, build) => {
			const { editor, ydoc, diagnostics, blockId } = createPeer();
			const before = editor.getBlock(blockId)!.textContent();

			expect(() => {
				editor.apply([build(blockId) as DocumentOp]);
			}).not.toThrow();

			expect(diagnostics).toContainEqual(
				expect.objectContaining({ code: MALFORMED_CODE }),
			);
			expect(editor.getBlock(blockId)!.textContent()).toBe(before);
			expect(() => Y.encodeStateAsUpdate(ydoc)).not.toThrow();

			editor.destroy();
		},
	);

	it.each<[string, unknown]>([
		["function", () => 1],
		["symbol", Symbol("s")],
		["bigint", 1n],
		["Date", new Date(0)],
		["Map", new Map([["k", 1]])],
		["null-prototype object", Object.create(null)],
		["Float32Array", new Float32Array([1])],
		["nested Date", { at: new Date(0) }],
		["nested function", [() => 1]],
	])(
		"OPB1: set-props with a %s value is dropped without writing the props before it",
		(_label, value) => {
			const { editor, ydoc, diagnostics, blockId } = createPeer();

			editor.apply([
				{
					type: "set-props",
					blockId,
					props: { a: 1, bad: value, z: 2 },
				} as unknown as DocumentOp,
			]);

			expect(diagnostics).toContainEqual(
				expect.objectContaining({ code: MALFORMED_CODE }),
			);
			expect(editor.getBlock(blockId)!.props).not.toHaveProperty("a");
			expect(() => Y.encodeStateAsUpdate(ydoc)).not.toThrow();

			editor.destroy();
		},
	);

	it("OPB1: insert-block with a function prop leaves no stored block outside the order", () => {
		const { editor, ydoc, diagnostics } = createPeer();

		editor.apply([
			{
				type: "insert-block",
				blockId: "fresh",
				blockType: "paragraph",
				props: { x: () => 1 },
				position: "last",
			} as unknown as DocumentOp,
		]);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({ code: MALFORMED_CODE }),
		);
		expect(ydoc.getMap("blocks").has("fresh")).toBe(false);
		expect(editor.getBlock("fresh")).toBeFalsy();

		editor.destroy();
	});

	it.each<[string, Record<string, unknown>]>([
		["Infinity", { color: Number.POSITIVE_INFINITY }],
		["nested NaN", { link: { n: Number.NaN } }],
		["Uint8Array", { bold: new Uint8Array([1]) }],
		["nested function", { link: { href: "x", f: () => 1 } }],
	])(
		"OPB1: format-text with a %s mark value is dropped because peers would decode it differently",
		(_label, marks) => {
			const { editor, diagnostics, blockId } = createPeer();

			editor.apply([
				{ type: "format-text", blockId, from: 0, to: 2, marks },
			]);

			expect(diagnostics).toContainEqual(
				expect.objectContaining({ code: MALFORMED_CODE }),
			);

			editor.destroy();
		},
	);

	it("OPB1: plain data, a Uint8Array and nested null-prototype objects still write as props", () => {
		const { editor, ydoc, diagnostics, blockId } = createPeer();
		const nested = Object.assign(Object.create(null), { k: 1 });

		editor.apply([
			{
				type: "set-props",
				blockId,
				props: {
					n: 1.5,
					s: "x",
					b: true,
					nil: null,
					list: [1, { a: "b" }],
					bytes: new Uint8Array([1, 2]),
					nested: { inner: nested },
				},
			},
		]);

		expect(diagnostics.filter((d) => d.code === MALFORMED_CODE)).toEqual(
			[],
		);
		expect(editor.getBlock(blockId)!.props).toMatchObject({
			n: 1.5,
			list: [1, { a: "b" }],
		});
		expect(() => Y.encodeStateAsUpdate(ydoc)).not.toThrow();

		editor.destroy();
	});

	it("OPB1: random malformed ops never throw from apply nor leave the document unencodable", () => {
		const random = mulberry32(0x5e7ae7a);
		const pick = <T>(items: readonly T[]): T =>
			items[Math.floor(random() * items.length)]!;
		const types: readonly DocumentOp["type"][] = [
			"splice-text",
			"format-text",
			"insert-block",
			"delete-block",
			"move-block",
			"set-props",
			"set-meta",
			"grid",
			"app",
			"stream-open",
		];
		const { editor, ydoc, blockId } = createPeer();
		const junk = (): unknown =>
			pick([
				undefined,
				null,
				0,
				-1,
				1.5,
				Number.NaN,
				"",
				"x",
				blockId,
				true,
				[],
				[undefined],
				{},
				{ a: undefined },
				{ n: 1n },
				1n,
				Symbol("s"),
				() => 1,
				cyclic(),
				"first",
				"last",
				{ after: blockId },
				{ parent: blockId, index: -1 },
				{ kind: "create" },
				{ kind: "update" },
				{ kind: "insert-row", index: 0 },
				{ bold: true },
				{ bold: undefined },
				{ nodeType: "mention", props: { n: 1n } },
			]);
		const fields = [
			"blockId",
			"blockType",
			"namespace",
			"data",
			"props",
			"position",
			"from",
			"to",
			"insert",
			"marks",
			"cell",
			"change",
		] as const;

		for (let i = 0; i < 400; i++) {
			const op: Record<string, unknown> = { type: pick(types) };
			for (const field of fields) {
				if (random() < 0.6) {
					op[field] = junk();
				}
			}
			const ops = random() < 0.1 ? [junk()] : [op];
			expect(() => editor.apply(ops as DocumentOp[])).not.toThrow();
			expect(() => Y.encodeStateAsUpdate(ydoc)).not.toThrow();
		}

		editor.destroy();
	});
});
