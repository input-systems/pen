import { createDocumentSession, createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { FIELD_EDITOR_SLOT_KEY, type Editor } from "@input/pen-types";
import { yjsAdapter } from "@input/pen-yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { multiplayerExtension } from "../index";
import {
	LOCAL_PRESENCE_MIN_INTERVAL_MS,
	MAX_PRESENCE_UPDATES_PER_SECOND,
} from "../presence/constants";
import { LocalPresenceWriter } from "../presence/localPresenceWriter";

describe("LocalPresenceWriter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("publishes the first request straight away", () => {
		const publish = vi.fn();
		const writer = new LocalPresenceWriter({ publish, minIntervalMs: 50 });

		writer.request();

		expect(publish).toHaveBeenCalledTimes(1);
		writer.cancel();
	});

	it("folds a burst into one trailing write", () => {
		const publish = vi.fn();
		const writer = new LocalPresenceWriter({ publish, minIntervalMs: 50 });

		for (let index = 0; index < 20; index += 1) {
			writer.request();
			vi.advanceTimersByTime(1);
		}

		expect(publish).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(50);
		expect(publish).toHaveBeenCalledTimes(2);

		// Nothing more to write, so the interval closes instead of ticking on.
		vi.advanceTimersByTime(500);
		expect(publish).toHaveBeenCalledTimes(2);
		writer.cancel();
	});

	it("stays inside what a peer accepts while typing continuously", () => {
		const publish = vi.fn();
		const writer = new LocalPresenceWriter({
			publish,
			minIntervalMs: LOCAL_PRESENCE_MIN_INTERVAL_MS,
		});

		// One selection change per 10ms is faster than anyone types.
		for (let index = 0; index < 100; index += 1) {
			writer.request();
			vi.advanceTimersByTime(10);
		}

		expect(publish.mock.calls.length).toBeLessThanOrEqual(
			MAX_PRESENCE_UPDATES_PER_SECOND,
		);
		writer.cancel();
	});

	it("holds a trailing request for the end of the interval", () => {
		const publish = vi.fn();
		const writer = new LocalPresenceWriter({ publish, minIntervalMs: 50 });

		writer.requestTrailing();
		writer.request();

		expect(publish).not.toHaveBeenCalled();
		vi.advanceTimersByTime(50);
		expect(publish).toHaveBeenCalledTimes(1);
		writer.cancel();
	});

	it("drops a pending write on cancel", () => {
		const publish = vi.fn();
		const writer = new LocalPresenceWriter({ publish, minIntervalMs: 50 });

		writer.request();
		writer.request();
		writer.cancel();
		vi.advanceTimersByTime(500);

		expect(publish).toHaveBeenCalledTimes(1);
	});
});

describe("local presence over an editor", () => {
	let editor: Editor;

	beforeEach(() => {
		vi.useFakeTimers();
		editor = createEditor({
			schema: defaultSchema,
			extensions: [
				multiplayerExtension({ user: { id: "u1", name: "Ada" } }),
			],
		});
	});

	afterEach(async () => {
		await editor.destroy();
		vi.useRealTimers();
	});

	it("coalesces a burst of selection changes and keeps the last one", () => {
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Ada and Charles",
				},
			],
			{ origin: "user" },
		);

		const localWrites: number[] = [];
		const countWrite = () => {
			localWrites.push(localWrites.length);
		};
		editor.internals.awareness?.on("change", countWrite);

		for (let offset = 0; offset < 15; offset += 1) {
			editor.selectText(blockId, offset, offset);
		}

		// One write for the first move; the rest wait for the interval.
		expect(localWrites.length).toBe(1);

		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);
		expect(localWrites.length).toBe(2);

		const local = editor.internals.awareness?.getLocalState() as {
			cursor?: { anchor?: string };
		};
		const cursor = editor.anchors.deserialize(local.cursor!.anchor!);
		expect(editor.anchors.resolve(cursor!)).toMatchObject({
			blockId,
			offset: 14,
		});

		editor.internals.awareness?.off("change", countWrite);
	});
});

describe("COL7: local presence follows focus", () => {
	let editor: Editor;
	let blockId: string;

	type LocalState = {
		user?: { id: string };
		cursor?: { anchor?: string } | null;
		selection?: unknown;
		streaming?: unknown;
		host?: unknown;
	};

	const localState = (): LocalState =>
		editor.internals.awareness?.getLocalState() as LocalState;

	const countLocalWrites = (): { count: number } => {
		const writes = {
			count: 0,
		};
		editor.internals.awareness?.on("change", () => {
			writes.count += 1;
		});
		return writes;
	};

	const cursorOffset = (): number | undefined => {
		const anchor = editor.anchors.deserialize(localState().cursor!.anchor!);
		return editor.anchors.resolve(anchor!)?.offset;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		editor = createEditor({
			schema: defaultSchema,
			extensions: [
				multiplayerExtension({ user: { id: "u1", name: "Ada" } }),
			],
		});
		blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Ada and Charles",
				},
			],
			{ origin: "user" },
		);
		editor.internals.emit("focusChange", true);
		editor.selectText(blockId, 3, 3);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);
	});

	afterEach(async () => {
		await editor.destroy();
		vi.useRealTimers();
	});

	it("COL7: a blur publishes no cursor or selection and keeps the other keys", () => {
		const awareness = editor.internals.awareness!;
		awareness.setLocalState({
			...awareness.getLocalState(),
			streaming: { blockId },
			host: "kept",
		});

		editor.internals.emit("focusChange", false);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		expect(localState()).toMatchObject({
			user: { id: "u1" },
			cursor: null,
			selection: null,
			streaming: { blockId },
			host: "kept",
		});
	});

	it("COL7: a refocus publishes the selection again", () => {
		editor.internals.emit("focusChange", false);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		editor.internals.emit("focusChange", true);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		expect(cursorOffset()).toBe(3);
	});

	it("COL7: selection changes and structural commits while blurred publish nothing", () => {
		editor.internals.emit("focusChange", false);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);
		const writes = countLocalWrites();

		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "remote",
					blockType: "paragraph",
					props: {},
					position: "last",
				},
			],
			{ origin: "collaborator" },
		);
		editor.selectText(blockId, 5, 5);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		expect(writes.count).toBe(0);
		expect(localState().cursor).toBeNull();
	});

	it("COL7: focus entering publishes the selection the click moves to, not the stale one", () => {
		editor.internals.emit("focusChange", false);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);
		const offsets: Array<number | undefined> = [];
		editor.internals.awareness?.on("change", () => {
			offsets.push(localState().cursor ? cursorOffset() : undefined);
		});

		editor.internals.emit("focusChange", true);
		editor.selectText(blockId, 10, 10);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		expect(offsets).toEqual([10]);
	});

	it("COL7: a blur and refocus within one interval publish the caret once", () => {
		const writes = countLocalWrites();

		editor.internals.emit("focusChange", false);
		editor.internals.emit("focusChange", true);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		expect(writes.count).toBe(1);
		expect(cursorOffset()).toBe(3);
	});
});

describe("COL7: presence before a renderer reports focus", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("COL7: an editor mounted unfocused publishes no cursor", async () => {
		vi.useFakeTimers();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				multiplayerExtension({ user: { id: "u1", name: "Ada" } }),
			],
		});
		const blockId = editor.firstBlock()!.id;

		editor.internals.emit("focusChange", false);
		editor.selectText(blockId, 0, 0);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		expect(editor.internals.awareness?.getLocalState()).toMatchObject({
			user: { id: "u1" },
			cursor: null,
			selection: null,
		});
		await editor.destroy();
	});

	it("COL7: a headless editor publishes its selection with no focus report", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				multiplayerExtension({ user: { id: "u1", name: "Ada" } }),
			],
		});
		const blockId = editor.firstBlock()!.id;

		editor.selectText(blockId, 0, 0);

		expect(
			(editor.internals.awareness?.getLocalState() as { cursor: unknown })
				.cursor,
		).not.toBeNull();
		await editor.destroy();
	});
});

describe("COL7: presence across runtimes and editors", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("COL7: a runtime rebuilt by loadDocument reads a blurred root from the field editor", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				multiplayerExtension({ user: { id: "u1", name: "Ada" } }),
			],
		});
		editor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, {
			hasFocusWithin: false,
		});
		editor.internals.emit("focusChange", false);

		editor.loadDocument(editor.internals.adapter.createDocument());
		await editor.whenReady();
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "loaded",
					blockType: "paragraph",
					props: {},
					position: "last",
				},
			],
			{ origin: "user" },
		);
		editor.selectText("loaded", 0, 0);

		expect(editor.internals.awareness?.getLocalState()).toMatchObject({
			cursor: null,
			selection: null,
		});
		await editor.destroy();
	});

	it("COL7: detaching another editor keeps the focused editor's caret", async () => {
		vi.useFakeTimers();
		const session = createDocumentSession({
			adapter: yjsAdapter(),
		});
		const createSessionEditor = () =>
			createEditor({
				schema: defaultSchema,
				documentSession: session,
				extensions: [
					multiplayerExtension({ user: { id: "u1", name: "Ada" } }),
				],
			});
		const blurred = createSessionEditor();
		const focused = createSessionEditor();
		const detached = createSessionEditor();
		const blockId = focused.firstBlock()!.id;
		focused.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Ada",
				},
			],
			{ origin: "user" },
		);
		blurred.internals.emit("focusChange", false);
		focused.internals.emit("focusChange", true);
		focused.selectText(blockId, 3, 3);
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		await detached.destroy();
		vi.advanceTimersByTime(LOCAL_PRESENCE_MIN_INTERVAL_MS);

		const local = focused.internals.awareness?.getLocalState() as {
			cursor: { anchor: string } | null;
		};
		const anchor = focused.anchors.deserialize(local.cursor!.anchor);
		expect(focused.anchors.resolve(anchor!)?.offset).toBe(3);
		await blurred.destroy();
		await focused.destroy();
		session.destroy();
	});
});
