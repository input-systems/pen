import type { Decoration, Editor, InlineDecoration } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import {
	createEditor as createCoreEditor,
	decorationsFacet,
	defineExtension,
	scopedDecorationSource,
	type DecorationSource,
} from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function mark(blockId: string, value: string): InlineDecoration {
	return { type: "inline", blockId, from: 0, to: 1, attributes: { mark: value } };
}

function editorWith(...sources: DecorationSource[]): Editor {
	const editor = createCoreEditor({
		schema: createDefaultSchema(),
		preset: noDefaultExtensionsPreset,
		extensions: [
			defineExtension({
				name: "decorations-under-test",
				facets: sources.map((source) => decorationsFacet.of(source)),
			}),
		],
	});
	editor.apply(
		["a", "b", "c"].map((blockId) => ({
			type: "insert-block" as const,
			blockId,
			blockType: "paragraph",
			props: {},
			position: "last" as const,
		})),
	);
	return editor;
}

function type(editor: Editor, blockId: string): void {
	editor.apply([{ type: "splice-text", blockId, from: 0, to: 0, insert: "x" }]);
}

/** A scoped source that marks every block it is asked about, and records calls. */
function recordingSource(options: { interest?: () => readonly string[] | "all" | null } = {}) {
	const calls: (readonly string[])[] = [];
	const source = scopedDecorationSource({
		interest: options.interest,
		decorate(blockIds) {
			calls.push([...blockIds]);
			return blockIds.map((blockId) => mark(blockId, "scoped"));
		},
	});
	return { source, calls };
}

describe("SCALE2 scoped decoration sources", () => {
	it("SCALE2: a scoped source that declares no interest is not called", () => {
		const { source, calls } = recordingSource({ interest: () => null });
		const editor = editorWith(source);
		calls.length = 0;
		type(editor, "b");
		expect(calls).toEqual([]);
		editor.destroy();
	});

	it("SCALE2: a scoped source is called once per commit with exactly the affected ids by default", () => {
		const { source, calls } = recordingSource();
		const editor = editorWith(source);
		calls.length = 0;
		type(editor, "b");
		expect(calls).toEqual([["b"]]);
		expect(editor.getDecorations().forBlock("b")).toEqual([mark("b", "scoped")]);
		editor.destroy();
	});

	it("SCALE2: unaffected blocks keep their decoration list and the set keeps its generation when nothing changed", () => {
		const { source } = recordingSource();
		const editor = editorWith(source);
		editor.requestDecorationUpdate();
		const before = editor.getDecorations();
		const untouched = before.forBlock("a");
		const events: number[] = [];
		editor.on("decorationsChange", (generation) => events.push(generation));
		type(editor, "b");
		const after = editor.getDecorations();
		expect(after).toBe(before);
		expect(after.generation).toBe(before.generation);
		expect(after.forBlock("a")).toBe(untouched);
		expect(events).toEqual([]);
		editor.destroy();
	});

	it("SCALE2: decorationsChange names the changed blocks, including blocks whose decorations were removed", () => {
		let marked = new Set(["a", "b"]);
		const source = scopedDecorationSource({
			interest: () => ["a", "b", "c"],
			decorate: (blockIds) =>
				blockIds.filter((blockId) => marked.has(blockId)).map((blockId) => mark(blockId, "m")),
		});
		const editor = editorWith(source);
		editor.requestDecorationUpdate();
		const changes: (readonly string[])[] = [];
		editor.on("decorationsChange", (_generation, changedBlockIds) => changes.push(changedBlockIds));
		marked = new Set(["b", "c"]);
		type(editor, "a");
		expect(changes).toHaveLength(1);
		expect([...(changes[0] ?? [])].sort()).toEqual(["a", "c"]);
		expect(editor.getDecorations().forBlock("a")).toEqual([]);
		editor.destroy();
	});

	it("SCALE2: decorations a scoped source returns for blocks it was not asked about are dropped with a diagnostic", () => {
		let stray = false;
		const source = scopedDecorationSource({
			decorate: (blockIds) => [
				...blockIds.map((blockId) => mark(blockId, "in")),
				...(stray ? [mark("c", "out")] : []),
			],
		});
		const editor = editorWith(source);
		stray = true;
		const codes: string[] = [];
		editor.on("diagnostic", (event) => codes.push(event.code));
		type(editor, "a");
		expect(codes).toContain("decoration-out-of-scope");
		expect(editor.getDecorations().forBlock("a")).toEqual([mark("a", "in")]);
		expect(editor.getDecorations().forBlock("c")).not.toContainEqual(mark("c", "out"));
		editor.destroy();
	});

	it("SCALE2: requestDecorationUpdate with a scope recomputes only that source for the named blocks", () => {
		const first = recordingSource({ interest: () => null });
		const second = recordingSource({ interest: () => null });
		let functionCalls = 0;
		const editor = editorWith(first.source, second.source, () => {
			functionCalls += 1;
			return { decorations: [], generation: 0, forBlock: () => [], inlineForBlock: () => [], equals: () => false };
		});
		first.calls.length = 0;
		second.calls.length = 0;
		functionCalls = 0;
		editor.requestDecorationUpdate({ source: second.source, blockIds: ["c"] });
		expect(first.calls).toEqual([]);
		expect(second.calls).toEqual([["c"]]);
		expect(functionCalls).toBe(0);
		editor.requestDecorationUpdate();
		expect(functionCalls).toBe(1);
		expect(first.calls).toEqual([]);
		editor.requestDecorationUpdate({ source: first.source, blockIds: "all" });
		expect(first.calls).toEqual([[...editor.documentState.preorderBlockIds()]]);
		editor.destroy();
	});

	it("R1: merged decorations for a block follow facet order across scoped and function sources", () => {
		const scoped = scopedDecorationSource({ decorate: (blockIds) => blockIds.map((blockId) => mark(blockId, "scoped")) });
		const fn = (): ReturnType<Extract<DecorationSource, (...args: never[]) => unknown>> => {
			const decorations: Decoration[] = [mark("a", "function")];
			return { decorations, generation: 0, forBlock: () => decorations, inlineForBlock: () => [], equals: () => false };
		};
		const editor = editorWith(fn, scoped);
		editor.requestDecorationUpdate();
		expect(editor.getDecorations().forBlock("a")).toEqual([mark("a", "function"), mark("a", "scoped")]);
		editor.destroy();
	});

	it("SCALE2: a removed block's decorations are dropped from every scoped source without a call", () => {
		const { source, calls } = recordingSource({ interest: () => null });
		const editor = editorWith(source);
		editor.requestDecorationUpdate({ source, blockIds: "all" });
		expect(editor.getDecorations().forBlock("b")).toHaveLength(1);
		calls.length = 0;
		editor.apply([{ type: "delete-block", blockId: "b" }]);
		expect(calls).toEqual([]);
		expect(editor.getDecorations().forBlock("b")).toEqual([]);
		editor.destroy();
	});
});
