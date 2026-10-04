import type {
	DiagnosticEvent,
	DocumentOp,
} from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { applySplitBlock, filterOpsForDocumentProfile } from "../index";
import {
	createEditor,
	createFlowEditor,
	flowPolicySchema,
} from "./ops.testHelpers";

const SPEC_PRIMITIVE_TYPES = [
	"app",
	"delete-block",
	"format-text",
	"grid",
	"insert-block",
	"move-block",
	"set-meta",
	"set-props",
	"splice-text",
	"stream-open",
] as const;

const PRIMITIVE_FLAGS = {
	app: true,
	"delete-block": true,
	"format-text": true,
	grid: true,
	"insert-block": true,
	"move-block": true,
	"set-meta": true,
	"set-props": true,
	"splice-text": true,
	"stream-open": true,
} as const satisfies Record<DocumentOp["type"], true>;

type ExtraPrimitiveKey = Exclude<
	keyof typeof PRIMITIVE_FLAGS,
	DocumentOp["type"]
>;
type MissingPrimitiveKey = Exclude<
	DocumentOp["type"],
	keyof typeof PRIMITIVE_FLAGS
>;
const _exactTen: [MissingPrimitiveKey] extends [never]
	? [ExtraPrimitiveKey] extends [never]
		? true
		: never
	: never = true;

function withRejectedOwnKey<T extends object>(op: T, key: string): T {
	const next = { ...op };
	Object.defineProperty(next, key, {
		value: { polluted: true },
		enumerable: true,
		configurable: true,
		writable: true,
	});
	return next;
}

function collectDiagnostics(editor: ReturnType<typeof createEditor>) {
	const diagnostics: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => {
		diagnostics.push(event);
	});
	return diagnostics;
}

function collectCommits(editor: ReturnType<typeof createEditor>) {
	const commits: unknown[] = [];
	editor.on("commit", (event) => {
		commits.push(event);
	});
	return commits;
}

function isProfileControlledType(type: DocumentOp["type"]): boolean {
	switch (type) {
		case "insert-block":
		case "set-props":
			return true;
		case "splice-text":
		case "format-text":
		case "delete-block":
		case "move-block":
		case "set-meta":
		case "grid":
		case "app":
		case "stream-open":
			return false;
		default: {
			const _exhaustive: never = type;
			return _exhaustive;
		}
	}
}

describe("ops op-boundary OPB1 OPB2 OPB5 OPB6", () => {
	it("OPB1: validate phase rejects proto keys on all ten payloads with PEN_APPLY_009", () => {
		const editor = createEditor();
		const seed = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId: seed,
				from: 0,
				to: 0,
				insert: "hello",
			},
			{
				type: "insert-block",
				blockId: "p2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		const diagnostics = collectDiagnostics(editor);
		const commits = collectCommits(editor);
		const rejectedKeys = ["__proto__", "constructor", "prototype"] as const;
		const payloads: DocumentOp[] = [
			{
				type: "splice-text",
				blockId: seed,
				from: 5,
				to: 5,
				insert: "!",
			},
			{
				type: "format-text",
				blockId: seed,
				from: 0,
				to: 5,
				marks: { bold: true },
			},
			{
				type: "insert-block",
				blockId: "hostile",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{ type: "delete-block", blockId: "p2" },
			{ type: "move-block", blockId: "p2", position: "first" },
			{ type: "set-props", blockId: seed, props: { type: "heading" } },
			{
				type: "set-meta",
				blockId: seed,
				namespace: "note",
				data: { a: 1 },
			},
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "insert-row", index: 0 },
			},
			{
				type: "app",
				change: {
					kind: "create",
					appId: "app-hostile",
					appType: "counter",
					config: { n: 1 },
					placement: { mode: "inline", blockId: seed, index: 0 },
				},
			},
			{ type: "stream-open", blockId: seed },
		];

		expect(payloads).toHaveLength(SPEC_PRIMITIVE_TYPES.length);
		const appliedTypes: string[] = [];
		for (const [index, payload] of payloads.entries()) {
			appliedTypes.push(payload.type);
			editor.apply([
				withRejectedOwnKey(
					payload,
					rejectedKeys[index % rejectedKeys.length]!,
				),
			]);
		}

		expect(appliedTypes.sort()).toEqual([...SPEC_PRIMITIVE_TYPES]);
		expect(
			diagnostics.filter((event) => event.code === "PEN_APPLY_009"),
		).toHaveLength(10);
		expect(commits).toHaveLength(0);
		expect(editor.getBlock(seed)!.textContent()).toBe("hello");
		expect(editor.getBlock("hostile")).toBeNull();
		expect(editor.getBlock("p2")).not.toBeNull();
		expect(editor.getBlock(seed)!.type).toBe("paragraph");
		expect(
			Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
		).toBe(false);
		editor.destroy();
	});

	it("OPB1: validate still emits PEN_APPLY_002 and drops a deleted v2 type with PEN_APPLY_004", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const diagnostics = collectDiagnostics(editor);

		editor.apply([
			{
				type: "insert-block",
				blockId: "missing-type",
				blockType: "not-a-registered-block",
				props: {},
				position: "last",
			},
		]);
		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "nope",
			} as unknown as DocumentOp,
		]);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({ code: "PEN_APPLY_002" }),
		);
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_APPLY_004",
				message: "unknown op type insert-text",
			}),
		);
		expect(editor.getBlock("missing-type")).toBeNull();
		expect(editor.getBlock(blockId)!.textContent()).toBe("");
		editor.destroy();
	});

	it("OPB2: one executor per primitive applies each of the ten variants", () => {
		const editor = createEditor();
		const seed = editor.firstBlock()!.id;
		const executed: DocumentOp["type"][] = [];
		editor.onBeforeApply((ops) => {
			for (const op of ops) {
				executed.push(op.type);
			}
			return ops;
		});
		const commits = collectCommits(editor);

		editor.apply([
			{
				type: "splice-text",
				blockId: seed,
				from: 0,
				to: 0,
				insert: "hello",
			},
		]);
		editor.apply([
			{
				type: "format-text",
				blockId: seed,
				from: 0,
				to: 5,
				marks: { bold: true },
			},
		]);
		editor.apply([
			{
				type: "insert-block",
				blockId: "p2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		const tableRowsBeforeGrid = editor
			.getBlock("t1")!
			.as("table")!
			.tableRowCount();
		editor.apply([
			{
				type: "set-props",
				blockId: seed,
				props: { type: "heading", level: 2 },
			},
		]);
		editor.apply([
			{
				type: "set-meta",
				blockId: seed,
				namespace: "note",
				data: { a: 1 },
			},
		]);
		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "insert-row", index: tableRowsBeforeGrid },
			},
		]);
		editor.apply([
			{
				type: "app",
				change: {
					kind: "create",
					appId: "app-1",
					appType: "counter",
					config: { n: 1 },
					placement: { mode: "inline", blockId: seed, index: 0 },
				},
			},
		]);
		editor.apply([{ type: "move-block", blockId: seed, position: "last" }]);
		const commitsBeforeStream = commits.length;
		editor.apply([{ type: "stream-open", blockId: seed }]);
		editor.apply([{ type: "delete-block", blockId: "p2" }]);

		expect([...new Set(executed)].sort()).toEqual([
			...SPEC_PRIMITIVE_TYPES,
		]);
		expect(editor.getBlock(seed)!.textContent()).toBe("hello");
		expect(editor.getBlock(seed)!.textDeltas()).toEqual([
			{ insert: "hello", attributes: { bold: true } },
		]);
		expect(editor.getBlock(seed)!.type).toBe("heading");
		expect(editor.getBlock(seed)!.meta("note")).toEqual({ a: 1 });
		expect(editor.getBlock("p2")).toBeNull();
		expect(editor.documentState.blockOrder.at(-1)).toBe(seed);
		expect(editor.getBlock("t1")!.as("table")!.tableRowCount()).toBe(
			tableRowsBeforeGrid + 1,
		);
		expect(commits.length).toBeGreaterThan(commitsBeforeStream);
		editor.destroy();
	});

	it("OPB2: splice-text executor is the union of v2 insert, delete, replace, atom, and cell edits", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "abcd",
			},
			{
				type: "splice-text",
				blockId,
				from: 1,
				to: 3,
				insert: "",
			},
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 1,
				insert: "A",
			},
			{
				type: "splice-text",
				blockId,
				from: 1,
				to: 1,
				insert: {
					nodeType: "mention",
					props: { id: "1", label: "Ada" },
				},
			},
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "cell",
			},
		]);

		expect(editor.getBlock(blockId)!.textContent()).toBe("Ad");
		expect(editor.getBlock(blockId)!.length()).toBe(3);
		expect(editor.getBlock(blockId)!.inlineDeltas()).toEqual([
			{ insert: "A" },
			{
				insert: { type: "mention", props: { id: "1", label: "Ada" } },
			},
			{ insert: "d" },
		]);
		expect(
			editor.getBlock("t1")!.as("table")!.tableCell(0, 0)!.textContent(),
		).toBe("cell");
		editor.destroy();
	});

	it("OPB5: profile allow/deny is keyed to the ten variants; flow drops disallowed insert-block and set-props conversion", () => {
		const seedOps: DocumentOp[] = [
			{
				type: "splice-text",
				blockId: "p1",
				from: 0,
				to: 0,
				insert: "ok",
			},
			{
				type: "format-text",
				blockId: "p1",
				from: 0,
				to: 1,
				marks: { bold: true },
			},
			{
				type: "insert-block",
				blockId: "ok",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "bad",
				blockType: "widget",
				props: {},
				position: "last",
			},
			{ type: "delete-block", blockId: "p1" },
			{ type: "move-block", blockId: "p1", position: "last" },
			{ type: "set-props", blockId: "p1", props: { type: "widget" } },
			{
				type: "set-meta",
				blockId: "p1",
				namespace: "note",
				data: { a: 1 },
			},
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "insert-row", index: 0 },
			},
			{
				type: "app",
				change: { kind: "delete", appId: "a1" },
			},
			{ type: "stream-open", blockId: "p1" },
		];
		const seen = new Set<DocumentOp["type"]>();
		for (const op of seedOps) {
			seen.add(op.type);
			void isProfileControlledType(op.type);
		}
		expect([...seen].sort()).toEqual([...SPEC_PRIMITIVE_TYPES]);

		const result = filterOpsForDocumentProfile(
			seedOps,
			"flow",
			flowPolicySchema,
		);
		expect(result.ops.map((op) => op.type).sort()).toEqual(
			[
				"app",
				"delete-block",
				"format-text",
				"grid",
				"insert-block",
				"move-block",
				"set-meta",
				"splice-text",
				"stream-open",
			].sort(),
		);
		expect(result.violations).toEqual([
			expect.objectContaining({
				blockType: "widget",
				reason: "flow-disallowed-block",
				op: expect.objectContaining({ type: "insert-block" }),
			}),
			expect.objectContaining({
				blockType: "widget",
				reason: "flow-disallowed-block",
				op: expect.objectContaining({ type: "set-props" }),
			}),
		]);
	});

	it("OPB5: a split recipe with intent pen.splitBlock that inserts a flow-disallowed type is dropped", () => {
		const editor = createFlowEditor();
		const source = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId: source,
				from: 0,
				to: 0,
				insert: "hello world",
			},
		]);
		applySplitBlock(editor, {
			blockId: source,
			offset: 6,
			newBlockId: "w-split",
			newBlockType: "widget",
			applyOptions: {
				origin: { type: "user", intent: "pen.splitBlock" },
			},
		});
		expect(editor.getBlock("w-split")).toBeNull();
		editor.destroy();
	});

	it("OPB6: exhaustive DocumentOp type tables expose exactly the ten primitive keys (runtime half)", () => {
		void _exactTen;
		const keys = Object.keys(PRIMITIVE_FLAGS).sort();
		expect(keys).toEqual([...SPEC_PRIMITIVE_TYPES]);
		expect(keys).toHaveLength(10);
		expect(SPEC_PRIMITIVE_TYPES).toHaveLength(10);
	});
});
