import { yjsAdapter } from "@input/pen-yjs";
import {
	type DocumentOp,
	type DocumentSession,
	type PenStreamPart,
} from "@input/pen-types";
import { defineExtension, getOpOriginType } from "@input/pen-core";
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

describe("@input/pen-core createEditor: teardown, undo rebinding, and diagnostics", () => {
	it("preserves formatted suffix text when deleting across blocks", () => {
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
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "b2",
				from: 0,
				to: 0,
				insert: "Again",
			},
			{
				type: "format-text",
				blockId: "b2",
				from: 2,
				to: 2 + 3,
				marks: { bold: true },
			},
		]);

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b2", offset: 2 },
		);
		editor.deleteSelection();

		expect(editor.getBlock("b1")?.textDeltas()).toEqual([
			{ insert: "He" },
			{
				insert: "ain",
				attributes: { bold: true },
			},
		]);
		expect(editor.getBlock("b2")).toBeNull();

		editor.destroy();
	});

	it("replaces multi-block text selections in a single document commit batch", () => {
		const editor = createEditor();
		const events: Array<{ ops: readonly DocumentOp[] }> = [];
		const commits: unknown[] = [];

		editor.on("commit", (event) => {
			commits.push(event);
		});
		editor.internals.onApplyBoundary((event) => {
			if (event.phase === "after" && event.applied) {
				events.push({ ops: event.ops });
			}
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "b1",
				from: 0,
				to: 0,
				insert: "Hello",
			},
			{
				type: "splice-text",
				blockId: "b2",
				from: 0,
				to: 0,
				insert: "World",
			},
			{
				type: "splice-text",
				blockId: "b3",
				from: 0,
				to: 0,
				insert: "Again",
			},
		]);
		events.length = 0;
		commits.length = 0;

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b3", offset: 2 },
		);
		editor.replaceSelection("X");

		expect(commits).toHaveLength(1);
		expect(events).toHaveLength(1);
		// Deletes and inserts are both splice-text under the 10-primitive union, so
		// the op shape is what distinguishes them: a delete empties a non-empty
		// range, an insert is collapsed (from === to) and carries content.
		expect(events[0]?.ops).toEqual([
			{ type: "splice-text", blockId: "b1", from: 2, to: 5, insert: "" },
			{ type: "splice-text", blockId: "b3", from: 0, to: 2, insert: "" },
			{ type: "delete-block", blockId: "b2" },
			{ type: "splice-text", blockId: "b1", from: 2, to: 2, insert: "X" },
			{
				type: "splice-text",
				blockId: "b1",
				from: 3,
				to: 3,
				insert: "ain",
			},
			{ type: "delete-block", blockId: "b3" },
		]);
		expect(editor.getBlock("b1")?.textContent()).toBe("HeXain");
		expect(editor.getBlock("b2")).toBeNull();
		expect(editor.getBlock("b3")).toBeNull();

		editor.destroy();
	});

	it("waits for async extension teardown before reactivating after loadDocument", async () => {
		const steps: string[] = [];
		let activationCount = 0;
		let resolveDeactivate!: () => void;
		const deactivatePromise = new Promise<void>((resolve) => {
			resolveDeactivate = resolve;
		});
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "async-lifecycle",
					activateClient: async () => {
						activationCount += 1;
						steps.push(`activate:${activationCount}`);
					},
					deactivateClient: async () => {
						steps.push("deactivate:start");
						await deactivatePromise;
						steps.push("deactivate:end");
					},
				}),
			],
		});

		await flushMicrotasks();

		editor.loadDocument(editor.internals.adapter.createDocument());
		await flushMicrotasks();

		expect(steps).toEqual(["activate:1", "deactivate:start"]);

		resolveDeactivate();
		await flushMicrotasks(4);

		expect(steps).toEqual([
			"activate:1",
			"deactivate:start",
			"deactivate:end",
			"activate:2",
		]);

		editor.destroy();
	});

	it("refreshes editor.undoManager immediately when the undo slot is set", async () => {
		const registeredUndoManager = {
			undo: () => false,
			redo: () => false,
			canUndo: () => false,
			canRedo: () => false,
			stopCapturing: () => {},
			withCapture: <T>(_origin: unknown, _groupId: unknown, run: () => T) => run(),
			setGroupTimeout: () => {},
			registerTrackedOrigins: () => () => {},
			onStackChange: () => () => {},
		};
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "test-undo-slot",
					activateClient: async ({ editor }) => {
						expect(editor.undoManager).not.toBe(
							registeredUndoManager,
						);
						editor.internals.assignSlot(
							"undo:manager",
							registeredUndoManager,
						);
						expect(editor.undoManager).toBe(registeredUndoManager);
					},
				}),
			],
		});

		await Promise.resolve();

		expect(editor.undoManager).toBe(registeredUndoManager);

		editor.destroy();
	});

	it("updates documentState parent relationships after parentId changes", () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "parent",
				blockType: "toggle",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "child",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "set-props",
				blockId: "child",
				props: { parentId: "parent" },
			},
		]);

		expect(editor.documentState.parentOf("child")).toBe("parent");

		editor.apply([
			{
				type: "set-props",
				blockId: "child",
				props: { parentId: null },
			},
		]);

		expect(editor.documentState.parentOf("child")).toBeNull();

		editor.destroy();
	});

	it("emits structured diagnostics for unknown block types", () => {
		const editor = createEditor();
		const diagnostics: unknown[] = [];

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "unknown",
				blockType: "not-real",
				props: {},
				position: "last",
			},
		]);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_APPLY_002",
				level: "warn",
				source: "apply",
			}),
		);

		editor.destroy();
	});

	it("emits remediation text for extension observe failures", () => {
		const diagnostics: unknown[] = [];
		const ext = defineExtension({
			name: "broken-observe",
			observe() {
				throw new Error("boom");
			},
		});
		const editor = createEditor({
			extensions: [ext],
		});

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_EXT_001",
				level: "error",
				source: "extension",
				remediation: expect.any(String),
			}),
		);

		editor.destroy();
	});

	it("emits diagnostics for rejected async extension activation", async () => {
		const diagnostics: unknown[] = [];
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "broken-async-activate",
					activateClient: async () => {
						await Promise.resolve();
						throw new Error("boom");
					},
				}),
			],
		});

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		await flushMicrotasks(4);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_EXT_004",
				level: "error",
				source: "extension",
				extension: "broken-async-activate",
				remediation: expect.any(String),
			}),
		);

		editor.destroy();
	});
});
