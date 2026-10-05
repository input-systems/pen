import type {
	CommitEvent,
	CommitEventSource,
	DocumentOp,
	SelectionRecord,
} from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { createHeadlessEditor, getEditorSelectionRecord } from "../index";
import { defaultSchema } from "./fixtures/testSchema";
import { TestRawDocLike, ownKeys } from "./observation.testHelpers";

const COMMIT_EVENT_KEYS = [
	"commitId",
	"diagnostics",
	"origin",
	"selectionAfter",
	"selectionBefore",
	"source",
	"summary",
] as const;

const SELECTION_RECORD_KEYS = [
	"commitId",
	"origin",
	"state",
	"version",
] as const;

const COMMIT_SOURCES: readonly CommitEventSource[] = [
	"apply",
	"remote",
	"undo",
	"redo",
	"stream",
];

function snapshotRecord(record: SelectionRecord): SelectionRecord {
	return {
		state: record.state,
		version: record.version,
		origin: record.origin,
		commitId: record.commitId,
	};
}

function createEditor() {
	return createHeadlessEditor({ schema: defaultSchema });
}

describe("observation — CommitEvent v2 fields (OB6)", () => {
	it("OB6: commitId starts at 1 and increments by 1 on each apply", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const commitIds: number[] = [];
		editor.on("commit", (event) => {
			commitIds.push(event.commitId);
		});

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "a",
			},
		]);
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 1,
				to: 1,
				insert: "b",
			},
		]);
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 2,
				to: 2,
				insert: "c",
			},
		]);

		expect(commitIds).toEqual([1, 2, 3]);
		expect(editor.getBlock(blockId)?.textContent()).toBe("abc");

		editor.destroy();
	});

	it("OB6: origin, selectionBefore, selectionAfter, source, and diagnostics keep their v2 contract", () => {
		const editor = createEditor();
		const firstId = editor.firstBlock()!.id;
		const secondId = "ob6-second";
		editor.apply([
			{
				type: "insert-block",
				blockId: secondId,
				blockType: "paragraph",
				props: {},
				position: { after: firstId },
			},
			{
				type: "splice-text",
				blockId: firstId,
				from: 0,
				to: 0,
				insert: "hello",
			},
		]);

		editor.selectText(firstId, 2, 2);
		const liveRecord = getEditorSelectionRecord(editor);
		if (liveRecord === null) {
			throw new Error(
				"selectText should have produced a selection record",
			);
		}
		const recordBeforeApply = snapshotRecord(liveRecord);

		const commits: CommitEvent[] = [];
		editor.on("commit", (event) => {
			commits.push(event);
		});

		const insertBeforeCaret = "X";
		editor.apply([
			{
				type: "splice-text",
				blockId: firstId,
				from: 0,
				to: 0,
				insert: insertBeforeCaret,
			},
		]);

		expect(commits).toHaveLength(1);
		const local = commits[0]!;
		expect(ownKeys(local)).toEqual([...COMMIT_EVENT_KEYS]);
		expect(local.source).toBe("apply");
		expect(local.origin).toEqual({ type: "user" });
		expect(local.diagnostics).toEqual([]);

		expect(ownKeys(local.selectionBefore)).toEqual([
			...SELECTION_RECORD_KEYS,
		]);
		expect(local.selectionBefore.version).toBe(recordBeforeApply.version);
		expect(local.selectionBefore.origin).toBe(recordBeforeApply.origin);
		expect(local.selectionBefore.commitId).toBe(recordBeforeApply.commitId);
		expect(local.selectionBefore.state).toEqual(recordBeforeApply.state);

		expect(ownKeys(local.selectionAfter)).toEqual([
			...SELECTION_RECORD_KEYS,
		]);
		expect(local.selectionAfter.version).toBeGreaterThanOrEqual(
			local.selectionBefore.version,
		);
		expect(local.selectionAfter.commitId).toBeGreaterThanOrEqual(
			local.selectionBefore.commitId,
		);
		expect(local.selectionAfter.state).toMatchObject({
			type: "text",
			anchor: { blockId: firstId, offset: 2 + insertBeforeCaret.length },
			focus: { blockId: firstId, offset: 2 + insertBeforeCaret.length },
		});

		const structuredOrigin = {
			type: "ai" as const,
			requestId: "ob6-req",
			groupId: "ob6-group",
		};
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: firstId,
					from: 1,
					to: 1,
					insert: "Y",
				},
			],
			{ origin: structuredOrigin },
		);
		const aiCommit = commits[1]!;
		expect(aiCommit.origin.type).toBe(structuredOrigin.type);
		expect(aiCommit.origin.requestId).toBe(structuredOrigin.requestId);
		expect(aiCommit.origin.groupId).toBe(structuredOrigin.groupId);
		expect(typeof aiCommit.origin).toBe("object");

		editor.apply([
			{
				type: "splice-text",
				blockId: firstId,
				from: -1,
				to: -1,
				insert: "nope",
			} as DocumentOp,
			{
				type: "splice-text",
				blockId: firstId,
				from: 0,
				to: 0,
				insert: "ok",
			},
		]);
		const diagnosed = commits[2]!;
		expect(diagnosed.diagnostics.length).toBeGreaterThan(0);
		expect(diagnosed.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "PEN_APPLY_004" }),
			]),
		);
		for (const diagnostic of diagnosed.diagnostics) {
			expect(typeof diagnostic.code).toBe("string");
			expect(["warn", "error", "info"]).toContain(diagnostic.level);
			expect(typeof diagnostic.source).toBe("string");
			expect(typeof diagnostic.message).toBe("string");
		}

		const adapter = editor.internals.adapter;
		const crdtDoc = editor.internals.crdtDoc;
		const remoteDoc = adapter.loadDocument(adapter.encodeState(crdtDoc));
		const remoteYDoc = adapter.raw<TestRawDocLike>(remoteDoc);
		const remoteYText = remoteYDoc
			.getMap("blocks")
			.get(secondId)
			?.get("content");
		if (!remoteYText) {
			throw new Error(`missing remote text for ${secondId}`);
		}
		remoteYDoc.transact(() => {
			remoteYText.insert(0, "peer");
		}, "y-websocket");
		adapter.applyUpdate(crdtDoc, adapter.encodeState(remoteDoc));
		const remote = commits.find((event) => event.source === "remote");
		expect(remote).toBeDefined();
		expect(remote!.origin).toEqual({ type: "collaborator" });
		expect(ownKeys(remote!)).toEqual([...COMMIT_EVENT_KEYS]);

		const undo = adapter.createUndoManager(crdtDoc, { captureTimeout: 0 });
		editor.apply([
			{
				type: "splice-text",
				blockId: secondId,
				from: 4,
				to: 4,
				insert: "!",
			},
		]);
		undo.stopCapturing();
		expect(undo.undo()).toBe(true);
		const undoCommit = commits.find((event) => event.source === "undo");
		expect(undoCommit).toBeDefined();
		expect(undoCommit!.origin.type).toBe("history");
		expect(ownKeys(undoCommit!)).toEqual([...COMMIT_EVENT_KEYS]);

		expect(undo.redo()).toBe(true);
		const redoCommit = commits.find((event) => event.source === "redo");
		expect(redoCommit).toBeDefined();
		expect(redoCommit!.origin.type).toBe("history");
		expect(ownKeys(redoCommit!)).toEqual([...COMMIT_EVENT_KEYS]);

		const writer = editor.openTextStream(
			{ blockId: secondId },
			{ origin: { type: "ai", groupId: "ob6-stream" } },
		);
		writer.append("z");
		writer.flush();
		const streamCommit = commits.find((event) => event.source === "stream");
		expect(streamCommit).toBeDefined();
		expect(streamCommit!.origin).toMatchObject({
			type: "ai",
			groupId: "ob6-stream",
			source: "stream",
		});
		expect(ownKeys(streamCommit!)).toEqual([...COMMIT_EVENT_KEYS]);
		writer.close();

		const seen = new Set(commits.map((event) => event.source));
		for (const source of COMMIT_SOURCES) {
			expect(seen.has(source)).toBe(true);
		}

		undo.destroy();
		editor.destroy();
	});
});
