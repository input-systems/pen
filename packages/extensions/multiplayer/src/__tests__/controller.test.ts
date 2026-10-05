import { createEditor } from "@input/pen-core";
import { createTestDocument } from "@input/pen-test";
import { describe, expect, it, vi } from "vitest";
import { MultiplayerControllerImpl } from "../controller";
import { AuthorLedger } from "../presence/authorLedger";
import { ClientIdentityMap } from "../presence/identityMap";
import type { MultiplayerAwarenessState } from "../types";
import { defaultSchema } from "@input/pen-schema";
import { wireCursor, wireTextSelection } from "./presenceAnchors";

function createDocumentEditor() {
	const { crdtDoc } = createTestDocument([
		{ id: "b1", type: "paragraph", content: "Hello" },
	]);
	return createEditor({ schema: defaultSchema,  document: crdtDoc });
}

function createController(editor = createEditor({ schema: defaultSchema })) {
	return new MultiplayerControllerImpl({
		editor,
		config: { user: { id: "u1", name: "Ada" } },
		authorLedger: new AuthorLedger(),
		identityMap: new ClientIdentityMap(),
	});
}

describe("MultiplayerControllerImpl", () => {
	it("starts disconnected with empty peer state", () => {
		const controller = createController();

		expect(controller.getState()).toEqual({
			connectionState: "disconnected",
			peers: [],
			localUser: { id: "u1", name: "Ada" },
			isConnected: false,
		});
		expect(controller.getPeers()).toEqual([]);
		expect(controller.getRemoteCursors()).toEqual([]);
		expect(controller.getRemoteSelections()).toEqual([]);
	});

	it("notifies subscribers when connection state changes", () => {
		const controller = createController();
		const listener = vi.fn();
		const unsubscribe = controller.subscribe(listener);

		controller.connect();
		controller.disconnect();
		unsubscribe();
		controller.connect();

		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("returns a snapshot of current state", () => {
		const controller = createController();

		const snapshot = controller.snapshot();

		expect(snapshot.state.localUser).toEqual({ id: "u1", name: "Ada" });
		expect(snapshot.remoteCursors).toEqual([]);
		expect(snapshot.remoteSelections).toEqual([]);
	});

	it("derives remote peers, cursors, and selections from awareness state", () => {
		const editor = createDocumentEditor();
		const controller = createController(editor);

		controller.handleAwarenessChange(
			new Map<number, MultiplayerAwarenessState>([
				[
					editor.clientId,
					{
						user: { id: "u1", name: "Ada" },
					},
				],
				[
					77,
					{
						user: { id: "u2", name: "Babbage", color: "#abc123" },
						cursor: wireCursor(editor, 3),
						selection: wireTextSelection(editor, 1, 3),
					},
				],
			]),
		);

		expect(controller.getRemoteCursors()).toEqual([
			{
				clientId: 77,
				user: {
					id: "u2",
					name: "Babbage",
					unverified: true,
					color: "#abc123",
				},
				blockId: "b1",
				offset: 3,
				clock: 10,
			},
		]);
		expect(controller.getRemoteSelections()).toEqual([
			{
				kind: "text",
				clientId: 77,
				user: {
					id: "u2",
					name: "Babbage",
					unverified: true,
					color: "#abc123",
				},
				anchor: { blockId: "b1", offset: 1 },
				head: { blockId: "b1", offset: 3 },
				clock: 11,
			},
		]);
		expect(controller.getPeers()).toEqual([
			{
				clientId: 77,
				user: {
					id: "u2",
					name: "Babbage",
					unverified: true,
					color: "#abc123",
				},
				cursor: {
					clientId: 77,
					user: {
						id: "u2",
						name: "Babbage",
						unverified: true,
						color: "#abc123",
					},
					blockId: "b1",
					offset: 3,
					clock: 10,
				},
				selection: {
					kind: "text",
					clientId: 77,
					user: {
						id: "u2",
						name: "Babbage",
						unverified: true,
						color: "#abc123",
					},
					anchor: { blockId: "b1", offset: 1 },
					head: { blockId: "b1", offset: 3 },
					clock: 11,
				},
				streaming: null,
				lastSeen: 11,
			},
		]);
	});

	it("retains author identities after peers leave awareness", () => {
		const editor = createEditor({ schema: defaultSchema });
		const controller = createController(editor);

		controller.handleAwarenessChange(
			new Map<number, MultiplayerAwarenessState>([
				[
					editor.clientId,
					{
						user: { id: "u1", name: "Ada" },
					},
				],
				[
					77,
					{
						user: { id: "u2", name: "Babbage", color: "#abc123" },
					},
				],
			]),
		);
		controller.handleAwarenessChange(
			new Map<number, MultiplayerAwarenessState>([
				[
					editor.clientId,
					{
						user: { id: "u1", name: "Ada" },
					},
				],
			]),
		);

		expect(controller.getPeers()).toEqual([]);
		expect(controller.getAuthorLedger().resolve(77)).toEqual({
			id: "u2",
			name: "Babbage",
			unverified: true,
			color: "#abc123",
		});
	});

	it("resolves remote carets minted before a later local insert", () => {
		const editor = createDocumentEditor();
		const cursor = wireCursor(editor, 3);
		const selection = wireTextSelection(editor, 1, 3);
		editor.apply(
			[{ type: "splice-text", blockId: "b1", from: 0,
				to: 0,
				insert: "xxx" }],
			{ origin: { type: "collaborator" } },
		);

		const controller = createController(editor);

		controller.handleAwarenessChange(
			new Map<number, MultiplayerAwarenessState>([
				[
					editor.clientId,
					{
						user: { id: "u1", name: "Ada" },
					},
				],
				[
					77,
					{
						user: { id: "u2", name: "Babbage", color: "#abc123" },
						cursor,
						selection,
					},
				],
			]),
		);

		expect(controller.getRemoteCursors()).toEqual([
			{
				clientId: 77,
				user: {
					id: "u2",
					name: "Babbage",
					unverified: true,
					color: "#abc123",
				},
				blockId: "b1",
				offset: 6,
				clock: 10,
			},
		]);
		expect(controller.getRemoteSelections()).toEqual([
			{
				kind: "text",
				clientId: 77,
				user: {
					id: "u2",
					name: "Babbage",
					unverified: true,
					color: "#abc123",
				},
				anchor: { blockId: "b1", offset: 4 },
				head: { blockId: "b1", offset: 6 },
				clock: 11,
			},
		]);
	});

	it("returns the same snapshot references when mapping is a no-op", () => {
		const editor = createDocumentEditor();
		const controller = createController(editor);

		expect(controller.getState()).toBe(controller.getState());
		expect(controller.getRemoteCursors()).toBe(controller.getRemoteCursors());
		expect(controller.getRemoteSelections()).toBe(
			controller.getRemoteSelections(),
		);

		controller.handleAwarenessChange(
			new Map<number, MultiplayerAwarenessState>([
				[
					editor.clientId,
					{
						user: { id: "u1", name: "Ada" },
					},
				],
				[
					77,
					{
						user: { id: "u2", name: "Babbage", color: "#abc123" },
						cursor: wireCursor(editor, 3),
						selection: wireTextSelection(editor, 1, 3),
					},
				],
			]),
		);

		const cursors = controller.getRemoteCursors();
		const selections = controller.getRemoteSelections();
		const state = controller.getState();
		expect(controller.getRemoteCursors()).toBe(cursors);
		expect(controller.getRemoteSelections()).toBe(selections);
		expect(controller.getState()).toBe(state);
	});

	it("a local keystroke that leaves the peer's presence unchanged notifies no one", () => {
		const editor = createDocumentEditor();
		const controller = createController(editor);
		controller.handleAwarenessChange(
			new Map<number, MultiplayerAwarenessState>([
				[editor.clientId, { user: { id: "u1", name: "Ada" } }],
				[
					77,
					{
						user: { id: "u2", name: "Babbage", color: "#abc123" },
						cursor: wireCursor(editor, 1),
						selection: wireTextSelection(editor, 0, 1),
					},
				],
			]),
		);
		const peers = controller.getPeers();
		const cursors = controller.getRemoteCursors();
		const selections = controller.getRemoteSelections();
		const listener = vi.fn();
		controller.subscribe(listener);

		// Five keystrokes after the peer's caret: its offset never moves.
		for (let at = 5; at < 10; at += 1) {
			editor.apply(
				[{ type: "splice-text", blockId: "b1", from: at, to: at, insert: "x" }],
				{ origin: "user" },
			);
		}

		expect(listener).toHaveBeenCalledTimes(0);
		expect(controller.getPeers()).toBe(peers);
		expect(controller.getRemoteCursors()).toBe(cursors);
		expect(controller.getRemoteSelections()).toBe(selections);

		// A keystroke before the caret moves it: one notification, new identities.
		editor.apply(
			[{ type: "splice-text", blockId: "b1", from: 0, to: 0, insert: "y" }],
			{ origin: "user" },
		);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(controller.getRemoteCursors()[0]?.offset).toBe(2);
		expect(controller.getPeers()).not.toBe(peers);
	});
});
