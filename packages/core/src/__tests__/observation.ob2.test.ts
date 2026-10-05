import {
	createSummarySource,
	isYjsCRDTDocument,
	type RawCommitDelta,
} from "@input/pen-yjs";
import type { CommitEvent, CommitEventSource } from "@input/pen-types";
import { describe, expect, it, vi } from "vitest";

import { createBlockIndexSnapshotFromDocument } from "../changes/fromDocument";
import * as summaryBuilder from "../changes/summaryBuilder";
import { createHeadlessEditor } from "../index";
import { defaultSchema } from "./fixtures/testSchema";
import { TestRawDocLike, ownKeys } from "./observation.testHelpers";

/**
 * ChangeSummary v3 own fields (`spec/rules/observation.md` §1).
 * Listed as a sorted array so the assertion is the exact set, both directions.
 */
const SECTION_1_SUMMARY_KEYS = [
	"affectedBlockIds",
	"blockText",
	"commitId",
	"structural",
] as const;

const SECTION_1_BLOCK_TEXT_KEYS = [
	"blockId",
	"cell",
	"formatRanges",
	"splices",
] as const;

const SECTION_1_SPLICE_KEYS = ["from", "insertLength", "to"] as const;

function omitCommitId<T extends { commitId: number }>(
	summary: T,
): Omit<T, "commitId"> {
	const { commitId: _commitId, ...rest } = summary;
	return rest;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (value == null || typeof value !== "object") {
		throw new Error("expected an object");
	}
	return value as Record<string, unknown>;
}

describe("observation — one builder (OB2)", () => {
	it("OB2: one builder produces summaries for local, remote, undo/redo, and stream commits", () => {
		const buildSpy = vi.spyOn(summaryBuilder, "buildChangeSummary");
		const emptySpy = vi.spyOn(summaryBuilder, "createEmptySummary");

		const editor = createHeadlessEditor({ schema: defaultSchema });
		const firstId = editor.firstBlock()!.id;
		const secondId = "ob2-second";
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
				insert: "meadow",
			},
		]);

		const crdtDoc = editor.internals.crdtDoc;
		if (!isYjsCRDTDocument(crdtDoc)) {
			throw new Error("expected a yjs document");
		}

		const capturedDeltas: RawCommitDelta[] = [];
		const stopSource = createSummarySource(crdtDoc, (delta) => {
			capturedDeltas.push(delta);
		});

		const bySource: Partial<Record<CommitEventSource, CommitEvent>> = {};
		editor.on("commit", (event) => {
			bySource[event.source] = event;
		});

		buildSpy.mockClear();
		emptySpy.mockClear();
		capturedDeltas.length = 0;

		const localInsert = "wild ";
		const indexBeforeLocal = createBlockIndexSnapshotFromDocument(
			editor.internals.doc,
		);
		editor.apply([
			{
				type: "splice-text",
				blockId: firstId,
				from: 0,
				to: 0,
				insert: localInsert,
			},
		]);
		expect(buildSpy).toHaveBeenCalled();
		expect(emptySpy).not.toHaveBeenCalled();
		expect(capturedDeltas).toHaveLength(1);
		const localBuilt = summaryBuilder.buildChangeSummary(
			capturedDeltas[0]!,
			indexBeforeLocal,
			0,
		);
		const localEvent = bySource.apply;
		expect(localEvent).toBeDefined();
		expect(omitCommitId(localEvent!.summary)).toEqual(
			omitCommitId(localBuilt),
		);

		buildSpy.mockClear();
		emptySpy.mockClear();
		capturedDeltas.length = 0;

		const remoteInsert = "peer";
		const adapter = editor.internals.adapter;
		const remoteDoc = adapter.loadDocument(adapter.encodeState(crdtDoc));
		const remoteYDoc = adapter.raw<TestRawDocLike>(remoteDoc);
		const remoteYText = remoteYDoc
			.getMap("blocks")
			.get(secondId)
			?.get("content");
		if (!remoteYText) {
			throw new Error(`missing remote text for ${secondId}`);
		}
		const indexBeforeRemote = createBlockIndexSnapshotFromDocument(
			editor.internals.doc,
		);
		remoteYDoc.transact(() => {
			remoteYText.insert(0, remoteInsert);
		}, "y-websocket");
		adapter.applyUpdate(crdtDoc, adapter.encodeState(remoteDoc));
		expect(buildSpy).toHaveBeenCalled();
		expect(emptySpy).not.toHaveBeenCalled();
		expect(capturedDeltas.length).toBeGreaterThan(0);
		const remoteBuilt = summaryBuilder.buildChangeSummary(
			capturedDeltas[capturedDeltas.length - 1]!,
			indexBeforeRemote,
			0,
		);
		const remoteEvent = bySource.remote;
		expect(remoteEvent).toBeDefined();
		expect(omitCommitId(remoteEvent!.summary)).toEqual(
			omitCommitId(remoteBuilt),
		);

		const undo = adapter.createUndoManager(crdtDoc, { captureTimeout: 0 });
		const undoInsert = "!";
		editor.apply([
			{
				type: "splice-text",
				blockId: firstId,
				from: 6 + localInsert.length,
				to: 6 + localInsert.length,
				insert: undoInsert,
			},
		]);
		undo.stopCapturing();

		buildSpy.mockClear();
		emptySpy.mockClear();
		capturedDeltas.length = 0;
		const indexBeforeUndo = createBlockIndexSnapshotFromDocument(
			editor.internals.doc,
		);
		expect(undo.undo()).toBe(true);
		expect(buildSpy).toHaveBeenCalled();
		expect(emptySpy).not.toHaveBeenCalled();
		expect(capturedDeltas.length).toBeGreaterThan(0);
		const undoBuilt = summaryBuilder.buildChangeSummary(
			capturedDeltas[capturedDeltas.length - 1]!,
			indexBeforeUndo,
			0,
		);
		const undoEvent = bySource.undo;
		expect(undoEvent).toBeDefined();
		expect(omitCommitId(undoEvent!.summary)).toEqual(
			omitCommitId(undoBuilt),
		);

		buildSpy.mockClear();
		emptySpy.mockClear();
		capturedDeltas.length = 0;
		const indexBeforeRedo = createBlockIndexSnapshotFromDocument(
			editor.internals.doc,
		);
		expect(undo.redo()).toBe(true);
		expect(buildSpy).toHaveBeenCalled();
		expect(emptySpy).not.toHaveBeenCalled();
		expect(capturedDeltas.length).toBeGreaterThan(0);
		const redoBuilt = summaryBuilder.buildChangeSummary(
			capturedDeltas[capturedDeltas.length - 1]!,
			indexBeforeRedo,
			0,
		);
		const redoEvent = bySource.redo;
		expect(redoEvent).toBeDefined();
		expect(omitCommitId(redoEvent!.summary)).toEqual(
			omitCommitId(redoBuilt),
		);

		buildSpy.mockClear();
		emptySpy.mockClear();
		capturedDeltas.length = 0;
		const streamInsert = "sage";
		const indexBeforeStream = createBlockIndexSnapshotFromDocument(
			editor.internals.doc,
		);
		const writer = editor.openTextStream(
			{ blockId: secondId },
			{ origin: { type: "ai", groupId: "ob2-stream" } },
		);
		writer.append(streamInsert);
		writer.flush();
		expect(buildSpy).toHaveBeenCalled();
		expect(emptySpy).not.toHaveBeenCalled();
		expect(capturedDeltas.length).toBeGreaterThan(0);
		const streamBuilt = summaryBuilder.buildChangeSummary(
			capturedDeltas[capturedDeltas.length - 1]!,
			indexBeforeStream,
			0,
		);
		const streamEvent = bySource.stream;
		expect(streamEvent).toBeDefined();
		expect(omitCommitId(streamEvent!.summary)).toEqual(
			omitCommitId(streamBuilt),
		);
		writer.close();

		const emitted = [
			localEvent!,
			remoteEvent!,
			undoEvent!,
			redoEvent!,
			streamEvent!,
		];
		const keySets = emitted.map((event) =>
			ownKeys(event.summary).join(","),
		);
		expect(new Set(keySets).size).toBe(1);

		stopSource();
		undo.destroy();
		buildSpy.mockRestore();
		emptySpy.mockRestore();
		editor.destroy();
	});

	it("OB2: emitted summary own keys equal the §1 field set and nothing else", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const firstId = editor.firstBlock()!.id;
		const insertedId = "ob2-inserted";
		const insert = "hello";
		const commits: CommitEvent[] = [];
		editor.on("commit", (event) => {
			commits.push(event);
		});

		editor.apply([
			{
				type: "splice-text",
				blockId: firstId,
				from: 0,
				to: 0,
				insert,
			},
			{
				type: "insert-block",
				blockId: insertedId,
				blockType: "paragraph",
				props: {},
				position: { after: firstId },
			},
		]);

		expect(commits).toHaveLength(1);
		const summary = asRecord(commits[0]!.summary);
		expect(ownKeys(summary)).toEqual([...SECTION_1_SUMMARY_KEYS]);

		expect(summary.commitId).toEqual(expect.any(Number));

		const blockText = summary.blockText;
		expect(Array.isArray(blockText)).toBe(true);
		const textChanges = blockText as readonly Record<string, unknown>[];
		expect(textChanges.length).toBeGreaterThan(0);
		const firstText = textChanges.find(
			(change) => change.blockId === firstId,
		);
		expect(firstText).toBeDefined();
		for (const key of ownKeys(firstText!)) {
			expect(SECTION_1_BLOCK_TEXT_KEYS).toContain(key);
		}
		expect(ownKeys(firstText!)).toEqual(
			expect.arrayContaining(["blockId", "formatRanges", "splices"]),
		);
		expect(firstText!.blockId).toBe(firstId);
		expect(firstText!.formatRanges).toEqual([]);
		const splices = firstText!.splices as readonly Record<
			string,
			unknown
		>[];
		expect(splices).toEqual([
			{ from: 0, to: 0, insertLength: insert.length },
		]);
		expect(ownKeys(splices[0]!)).toEqual([...SECTION_1_SPLICE_KEYS]);

		const structural = summary.structural as readonly Record<
			string,
			unknown
		>[];
		expect(structural).toContainEqual({
			type: "block-inserted",
			blockId: insertedId,
			parentId: null,
			index: 1,
		});

		expect(summary.affectedBlockIds).toEqual([firstId, insertedId]);

		editor.destroy();
	});
});
