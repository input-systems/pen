// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createDocumentSession, createEditor } from "@input/pen-core";
import { getSnapshotsController, snapshotsExtension } from "@input/pen-snapshots";
import {
	getMultiplayerController,
	multiplayerExtension,
} from "@input/pen-multiplayer";
import {
	SNAPSHOTS_CONTROLLER_SLOT,
	MULTIPLAYER_CONTROLLER_SLOT,
	type VersionMetadata,
	type VersionEntry,
} from "@input/pen-types";
import { defaultSchema } from "@input/pen-schema";
import {
	Pen,
	useAttribution,
	useSnapshots,
	useMultiplayer,
	useRemoteCursors,
	useRemoteSelections,
} from "../index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react history and multiplayer hooks", () => {
	it("renders multiplayer primitives while hooks expose the same controller state", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				multiplayerExtension({
					user: {
						id: "u1",
						name: "Ada",
					},
					autoConnect: false,
				}),
			],
		});
		const controller = getMultiplayerController(editor) as {
			handleAwarenessChange(
				states: Map<number, Record<string, unknown>>,
			): void;
		} | null;
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hi" },
		]);

		controller?.handleAwarenessChange(
			new Map<number, Record<string, unknown>>([
				[
					editor.clientId,
					{
						user: {
							id: "u1",
							name: "Ada",
						},
					},
				],
				[
					77,
					{
						user: {
							id: "u2",
							name: "Babbage",
							color: "#abc123",
						},
						cursor: {
							anchor: encodeAnchor(editor, blockId, 2),
							clock: 1,
						},
						selection: {
							anchor: encodeAnchor(editor, blockId, 1),
							head: encodeAnchor(editor, blockId, 2),
							clock: 1,
						},
					},
				],
			]),
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		function MultiplayerProbe() {
			const state = useMultiplayer(editor);
			const remoteCursors = useRemoteCursors(editor);
			const remoteSelections = useRemoteSelections(editor);

			return (
				<div
					data-peer-count={state.peers.length}
					data-cursor-count={remoteCursors.length}
					data-selection-count={remoteSelections.length}
				/>
			);
		}

		await act(async () => {
			root.render(
				<>
					<MultiplayerProbe />
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Multiplayer.PresenceList />
						<Pen.Multiplayer.RemoteCursors />
						<Pen.Multiplayer.CaretOverlay />
					</Pen.Editor.Root>
				</>,
			);
		});

		expect(
			container
				.querySelector("[data-peer-count]")
				?.getAttribute("data-peer-count"),
		).toBe("1");
		expect(
			container
				.querySelector("[data-cursor-count]")
				?.getAttribute("data-cursor-count"),
		).toBe("1");
		expect(
			container
				.querySelector("[data-selection-count]")
				?.getAttribute("data-selection-count"),
		).toBe("1");
		expect(
			container.querySelector("[data-pen-multiplayer-presence-avatar]")
				?.textContent,
		).toBe("Babbage");
		expect(
			container
				.querySelector("[data-pen-multiplayer-remote-cursor]")
				?.getAttribute("data-user-name"),
		).toBe("Babbage");
		expect(
			container
				.querySelector("[data-pen-multiplayer-caret-overlay]")
				?.getAttribute("data-cursor-count"),
		).toBe("1");
		// The remote caret and its label are painted by pen-dom's overlay in
		// the next scheduler flush (OV1), not during React's render.
		await act(async () => {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		});
		expect(
			container.querySelector("[data-pen-multiplayer-caret-label]")
				?.textContent,
		).toBe("Babbage");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps history and attribution as hooks", async () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const historyController = createMockHistoryController(blockId, 1);
		editor.internals.assignSlot(SNAPSHOTS_CONTROLLER_SLOT, historyController);
		editor.internals.assignSlot(MULTIPLAYER_CONTROLLER_SLOT, {
			subscribe() {
				return () => {};
			},
			getIdentityMap() {
				return {
					resolve(clientId: number) {
						if (clientId === 77) {
							return {
								id: "u2",
								name: "Babbage",
								color: "#abc123",
							};
						}
						return {
							id: String(clientId),
							name: `User ${clientId}`,
						};
					},
				};
			},
		});

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		function HistoryProbe() {
			const history = useSnapshots(editor);
			const attribution = useAttribution(editor, blockId);

			return (
				<div
					data-snapshot-count={history.snapshots.length}
					data-blame-name={attribution.blameRanges[0]?.author.name}
				/>
			);
		}

		await act(async () => {
			root.render(<HistoryProbe />);
		});

		expect(
			container
				.querySelector("[data-snapshot-count]")
				?.getAttribute("data-snapshot-count"),
		).toBe("1");
		expect(
			container
				.querySelector("[data-blame-name]")
				?.getAttribute("data-blame-name"),
		).toBe("Babbage");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("shares history hook state across editors on the same document session", async () => {
		const seedEditor = createEditor({ schema: defaultSchema });
		const documentSession = createDocumentSession({
			adapter: seedEditor.internals.adapter,
		});
		const persistence = createMemoryPersistence();
		const editorA = createEditor({
			schema: defaultSchema,
			documentSession,
			extensions: [
				snapshotsExtension({
					persistence,
					docId: "doc-1",
					autoSnapshot: false,
				}),
			],
		});
		const editorB = createEditor({
			schema: defaultSchema,
			documentSession,
			extensions: [
				snapshotsExtension({
					persistence,
					docId: "doc-1",
					autoSnapshot: false,
				}),
			],
		});
		const controller = getSnapshotsController(editorA)!;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		await waitForSharedHistoryController(editorA, editorB);

		function SharedHistoryProbe() {
			const historyA = useSnapshots(editorA);
			const historyB = useSnapshots(editorB);
			return (
				<div
					data-snapshot-count-a={historyA.snapshots.length}
					data-snapshot-count-b={historyB.snapshots.length}
				/>
			);
		}

		await act(async () => {
			root.render(<SharedHistoryProbe />);
		});

		await act(async () => {
			await controller.createSnapshot("Checkpoint", "manual");
		});

		expect(
			container
				.querySelector("[data-snapshot-count-a]")
				?.getAttribute("data-snapshot-count-a"),
		).toBe("1");
		expect(
			container
				.querySelector("[data-snapshot-count-b]")
				?.getAttribute("data-snapshot-count-b"),
		).toBe("1");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		seedEditor.destroy();
		editorA.destroy();
		editorB.destroy();
		documentSession.destroy();
	});
});

function createMockHistoryController(
	blockId: string,
	initialSnapshotCount = 0,
) {
	let state = {
		snapshots: buildSnapshotEntries(initialSnapshotCount),
		isRestoring: false,
	};
	const listeners = new Set<() => void>();

	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getState() {
			return state;
		},
		getCharacterAttribution() {
			return [
				{
					blockId,
					offset: 0,
					length: 3,
					clientId: 77,
					userId: "u2",
					userName: "Babbage",
					color: "#abc123",
					timestamp: 0,
				},
			];
		},
		getBlameRanges() {
			return [
				{
					from: 0,
					to: 3,
					author: {
						id: "u2",
						name: "Babbage",
						color: "#abc123",
					},
					timestamp: 0,
				},
			];
		},
	};
}

async function waitForSharedHistoryController(
	editorA: ReturnType<typeof createEditor>,
	editorB: ReturnType<typeof createEditor>,
): Promise<void> {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const controllerA = getSnapshotsController(editorA);
		const controllerB = getSnapshotsController(editorB);
		if (controllerA && controllerA === controllerB) {
			return;
		}
		await Promise.resolve();
	}
	throw new Error("Expected both editors to share a history controller.");
}

function buildSnapshotEntries(count: number): VersionEntry[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `version-${index + 1}`,
		metadata: {
			label: "Checkpoint",
			trigger: "manual",
			clientId: 1,
			timestamp: index + 1,
		},
		createdAt: index + 1,
	}));
}

function createMemoryPersistence() {
	const entries: Array<{
		id: string;
		snapshot: Uint8Array;
		metadata: VersionMetadata;
		createdAt: number;
	}> = [];
	let nextId = 1;

	return {
		async loadDocument() {
			return null;
		},
		async saveSnapshot() {},
		async appendUpdate() {},
		async getUpdates() {
			return [];
		},
		async compact() {},
		async saveVersionSnapshot(
			_docId: string,
			snapshot: Uint8Array,
			metadata: VersionMetadata,
		) {
			entries.push({
				id: `version-${nextId++}`,
				snapshot: new Uint8Array(snapshot),
				metadata,
				createdAt: metadata.timestamp,
			});
		},
		async listVersions() {
			return [...entries]
				.sort((left, right) => right.createdAt - left.createdAt)
				.map((entry) => ({
					id: entry.id,
					metadata: entry.metadata,
					createdAt: entry.createdAt,
				}));
		},
		async loadVersion(_docId: string, versionId: string) {
			const entry = entries.find(
				(candidate) => candidate.id === versionId,
			);
			if (!entry) {
				throw new Error(`Missing version ${versionId}`);
			}
			return {
				state: new Uint8Array(entry.snapshot),
				snapshot: new Uint8Array(entry.snapshot),
			};
		},
	};
}

function encodeAnchor(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
	offset: number,
): string {
	const minted = editor.anchors.create({ blockId, offset }, 1);
	if (minted === null) {
		throw new Error("Could not mint a presence anchor");
	}
	return editor.anchors.serialize(minted);
}
