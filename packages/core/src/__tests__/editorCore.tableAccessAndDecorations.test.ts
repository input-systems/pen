import { yjsAdapter } from "@input/pen-yjs";
import { type DocumentSession, type PenStreamPart } from "@input/pen-types";
import {
	decorationsFacet,
	defineExtension,
	getOpOriginType,
} from "@input/pen-core";
import { describe, expect, it, vi } from "vitest";

import { createDefaultSchema } from "./fixtures/testSchema";
import {
	createDecorationSet,
	createDocumentSession,
	createEditor as createCoreEditor,
	createHeadlessEditor,
	ensureInlineCompletionController,
} from "../index";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createEditor(options: Parameters<typeof createCoreEditor>[0] = {}) {
	return createCoreEditor({
		schema: createDefaultSchema(),
		...options,
		preset: options.preset ?? noDefaultExtensionsPreset,
	});
}

function createDefaultEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
) {
	return createCoreEditor({
		schema: createDefaultSchema(),
		...options,
	});
}

async function* createStream(parts: PenStreamPart[]) {
	for (const part of parts) {
		yield part;
	}
}

async function flushMicrotasks(count = 2): Promise<void> {
	for (let index = 0; index < count; index++) {
		await Promise.resolve();
	}
}

type TestYTextLike = {
	insert(offset: number, text: string): void;
};

type TestBlockMapLike = {
	get(key: string): unknown;
};

type TestBlocksMapLike = {
	get(key: string): TestBlockMapLike | undefined;
};

type TestRawDocLike = {
	getMap(name: "blocks"): TestBlocksMapLike;
};

type TestTableRowLike = {
	get(field: "cells"): { delete(index: number, length: number): void };
};

type TestTableContentLike = {
	get(index: number): TestTableRowLike;
};

describe("@input/pen-core table operations: cell access and decoration caching", () => {
	it("convert-block to table preserves inline text in the first cell", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "Hello table",
			},
		]);

		editor.apply([
			{
				type: "set-props",
				blockId: "b1",
				props: { type: "table", ...{} },
			},
		]);

		const block = editor.getBlock("b1")!;
		expect(block.type).toBe("table");
		expect(block.as("table")!.tableCell(0, 0)?.textContent()).toBe(
			"Hello table",
		);
		expect(block.as("table")!.tableCell(0, 1)?.textContent()).toBe("");
		expect(block.as("table")!.tableCell(1, 0)?.textContent()).toBe("");
		expect(block.as("table")!.tableCell(1, 1)?.textContent()).toBe("");

		editor.destroy();
	});

	it("tableCell returns null for out-of-bounds coordinates", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		const block = editor.getBlock("t1")!;
		expect(block.as("table")!.tableCell(-1, 0)).toBeNull();
		expect(block.as("table")!.tableCell(0, -1)).toBeNull();
		expect(block.as("table")!.tableCell(99, 0)).toBeNull();
		expect(block.as("table")!.tableCell(0, 99)).toBeNull();

		editor.destroy();
	});

	it('API5: as("table") is null for non-table blocks', () => {
		const editor = createEditor();

		const block = editor.firstBlock()!;
		expect(block.as("table")).toBeNull();

		editor.destroy();
	});

	it("SCALE2: a refresh that changes nothing keeps the decoration set by identity", () => {
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "test-decorations",
					facets: [
						decorationsFacet.of((_state, currentEditor) => {
							const blockId = currentEditor.firstBlock()?.id;
							if (!blockId) {
								return createDecorationSet([]);
							}

							return createDecorationSet([
								{
									type: "block",
									blockId,
									attributes: { active: true },
								},
							]);
						}),
					],
				}),
			],
		});
		const onDecorationsChange = vi.fn();
		editor.on("decorationsChange", onDecorationsChange);

		const initialDecorations = editor.getDecorations();
		expect(editor.getDecorations()).toBe(initialDecorations);

		editor.apply(
			[
				{
					type: "splice-text",
					blockId: editor.firstBlock()!.id,
					from: 0,
					to: 0,
					insert: "trigger",
				},
			],
			{ origin: "user" },
		);

		// the facet rebuilt an equal decoration, so the set and its generation hold
		expect(editor.getDecorations()).toBe(initialDecorations);

		editor.requestDecorationUpdate();

		expect(editor.getDecorations()).toBe(initialDecorations);
		expect(onDecorationsChange).not.toHaveBeenCalled();

		editor.destroy();
	});

	it("SCALE2: a refresh that changes one block keeps the other blocks' lists by identity", () => {
		let revealedTo = 1;
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "test-decorations",
					facets: [
						decorationsFacet.of((_state, currentEditor) => {
							const [first, second] = currentEditor.documentState.blockOrder;
							if (!first || !second) {
								return createDecorationSet([]);
							}

							return createDecorationSet([
								{
									type: "block",
									blockId: first,
									attributes: { active: true },
								},
								{
									type: "inline",
									blockId: second,
									from: 0,
									to: revealedTo,
									attributes: {},
									omitFromRender: true,
								},
							]);
						}),
					],
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "second",
					blockType: "paragraph",
					props: {},
					position: "last",
				},
				{
					type: "splice-text",
					blockId: "second",
					from: 0,
					to: 0,
					insert: "hidden words",
				},
			],
			{ origin: "user" },
		);
		const onDecorationsChange = vi.fn();
		editor.on("decorationsChange", onDecorationsChange);

		const before = editor.getDecorations();
		const firstBlockList = before.forBlock(firstBlockId);
		const secondBlockList = before.forBlock("second");

		revealedTo = 6;
		editor.requestDecorationUpdate();

		const after = editor.getDecorations();
		expect(after).not.toBe(before);
		expect(onDecorationsChange).toHaveBeenCalledTimes(1);
		expect(after.forBlock(firstBlockId)).toBe(firstBlockList);
		expect(after.forBlock("second")).not.toBe(secondBlockList);
		expect(after.forBlock("second")).toEqual([
			expect.objectContaining({ from: 0, to: 6 }),
		]);

		editor.destroy();
	});
});
