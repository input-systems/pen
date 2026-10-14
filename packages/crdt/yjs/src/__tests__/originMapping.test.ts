import { readFileSync } from "node:fs";

import type { CRDTEvent, OpOrigin } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { yjsAdapter } from "../adapter";
import { initBlockMap } from "../document";
import type { YjsCRDTDocument } from "../document";
import {
	ORIGIN_UNKNOWN_CODE,
	createObserver,
	createRemoteUpdateOrigin,
	normalizeTransactionOrigin,
	originToOpOrigin,
} from "../events";
import { createYjsUndoManager } from "../undo";
import { createPeerDoc } from "./createPeerDoc";

function getOpOriginType(origin: OpOrigin): string {
	return typeof origin === "string" ? origin : origin.type;
}

const adapter = yjsAdapter();

function seedParagraph(doc: YjsCRDTDocument, blockId = "block-1"): Y.Text {
	doc.ydoc.transact(() => {
		initBlockMap(doc.penDocument.blocks, blockId, "paragraph", "inline");
		doc.penDocument.blockOrder.push([blockId]);
	});
	return doc.penDocument.blocks.get(blockId)!.get("content") as Y.Text;
}

describe("COL1 origin mapping", () => {
	it("COL1: mapping table — user only when Pen set it; remote is collaborator; absent/unrecognized is system", () => {
		expect(originToOpOrigin("user", true)).toEqual({ type: "user" });
		expect(originToOpOrigin("user", false)).toEqual({
			type: "collaborator",
			source: "user",
		});
		expect(originToOpOrigin("ai")).toEqual({ type: "ai" });
		expect(originToOpOrigin("migration")).toEqual({ type: "migration" });
		expect(originToOpOrigin("collaborator")).toEqual({
			type: "collaborator",
		});
		expect(originToOpOrigin(null, false)).toEqual({ type: "collaborator" });
		expect(originToOpOrigin(undefined, false)).toEqual({
			type: "collaborator",
		});
		expect(originToOpOrigin(null, true)).toEqual({
			type: "system",
			source: "absent",
		});
		expect(originToOpOrigin(undefined)).toEqual({
			type: "system",
			source: "absent",
		});
		expect(originToOpOrigin("some-unknown-origin")).toEqual({
			type: "system",
			source: "some-unknown-origin",
		});
		expect(originToOpOrigin({ kind: "provider" })).toEqual({
			type: "system",
			source: "unrecognized",
		});
		expect(originToOpOrigin({ type: "not-a-pen-origin" })).toEqual({
			type: "system",
			source: "not-a-pen-origin",
		});

		const tagged = createRemoteUpdateOrigin({ actorId: "peer-b" });
		expect(originToOpOrigin(tagged, false)).toEqual(tagged);
		expect(getOpOriginType(originToOpOrigin(tagged, false))).toBe(
			"collaborator",
		);
	});

	it("2.3: unknown origin tags emit ORIGIN_UNKNOWN and store structured system", () => {
		const unknown = normalizeTransactionOrigin("y-websocket", true);
		expect(unknown.origin).toEqual({
			type: "system",
			source: "y-websocket",
		});
		expect(unknown.diagnostic?.code).toBe(ORIGIN_UNKNOWN_CODE);

		const known = normalizeTransactionOrigin("user", true);
		expect(known.diagnostic).toBeNull();
	});

	it("2.3: applyUpdate tags collaborator even when the sender used a provider-custom origin", () => {
		const peerA = createPeerDoc(adapter, 1);
		const peerB = createPeerDoc(adapter, 2);
		seedParagraph(peerA);
		adapter.applyUpdate(peerB, adapter.encodeState(peerA));
		expect(
			(
				peerB.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		).toBe(
			(
				peerA.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		);

		const events: CRDTEvent[] = [];
		createObserver(peerA, (event) => events.push(event));

		const remoteText = peerB.penDocument.blocks
			.get("block-1")!
			.get("content") as Y.Text;
		peerB.ydoc.transact(() => {
			remoteText.insert(0, "from B");
		}, "y-websocket");

		adapter.applyUpdate(
			peerA,
			Y.encodeStateAsUpdate(peerB.ydoc, Y.encodeStateVector(peerA.ydoc)),
		);

		expect(
			(
				peerA.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		).toBe("from B");
		expect(remoteText.toString()).toBe("from B");
		expect(events).toHaveLength(1);
		expect(events[0].origin).toEqual({ type: "collaborator" });
	});

	it("COL1: remote applyUpdate surfaces collaborator origin", () => {
		const peerA = createPeerDoc(adapter, 1);
		const peerB = createPeerDoc(adapter, 2);
		seedParagraph(peerA);
		adapter.applyUpdate(peerB, adapter.encodeState(peerA));
		expect(
			(
				peerB.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		).toBe(
			(
				peerA.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		);

		const events: CRDTEvent[] = [];
		createObserver(peerA, (event) => events.push(event));

		const remoteText = peerB.penDocument.blocks
			.get("block-1")!
			.get("content") as Y.Text;
		peerB.ydoc.transact(() => {
			remoteText.insert(0, "from B");
		}, "user");

		adapter.applyUpdate(
			peerA,
			Y.encodeStateAsUpdate(peerB.ydoc, Y.encodeStateVector(peerA.ydoc)),
		);

		expect(
			(
				peerA.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		).toBe("from B");
		expect(remoteText.toString()).toBe("from B");
		expect(events).toHaveLength(1);
		expect(events[0].origin).toEqual({ type: "collaborator" });
		expect(getOpOriginType(events[0].origin)).not.toBe("user");
	});

	it("COL1: applyUpdate tagged with createRemoteUpdateOrigin keeps collaborator identity", () => {
		const peerA = createPeerDoc(adapter, 1);
		const peerB = createPeerDoc(adapter, 2);
		seedParagraph(peerA);
		adapter.applyUpdate(peerB, adapter.encodeState(peerA));
		expect(
			(
				peerB.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		).toBe(
			(
				peerA.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		);

		const events: CRDTEvent[] = [];
		createObserver(peerA, (event) => events.push(event));

		const remoteText = peerB.penDocument.blocks
			.get("block-1")!
			.get("content") as Y.Text;
		peerB.ydoc.transact(() => {
			remoteText.insert(0, "tagged");
		}, "user");

		const remoteOrigin = createRemoteUpdateOrigin({ actorId: "peer-b" });
		Y.applyUpdate(
			peerA.ydoc,
			Y.encodeStateAsUpdate(peerB.ydoc, Y.encodeStateVector(peerA.ydoc)),
			remoteOrigin,
		);

		expect(
			(
				peerA.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		).toBe("tagged");
		expect(remoteText.toString()).toBe("tagged");
		expect(events).toHaveLength(1);
		expect(events[0].origin).toEqual(remoteOrigin);
		expect(getOpOriginType(events[0].origin)).toBe("collaborator");
	});

	it("COL1: absent origin is unknown not user", () => {
		const doc = createPeerDoc(adapter);
		const ytext = seedParagraph(doc);
		const events: CRDTEvent[] = [];
		createObserver(doc, (event) => events.push(event));

		doc.ydoc.transact(() => {
			ytext.insert(0, "local unlabeled");
		});

		expect(events).toHaveLength(1);
		expect(events[0].origin).toEqual({ type: "system", source: "absent" });
		expect(getOpOriginType(events[0].origin)).not.toBe("user");
	});

	it("COL1: adapter.transact still labels Pen-set missing origin as user", () => {
		const doc = createPeerDoc(adapter);
		seedParagraph(doc);
		const events: CRDTEvent[] = [];
		createObserver(doc, (event) => events.push(event));

		adapter.transact(doc, () => {
			const ytext = doc.penDocument.blocks
				.get("block-1")!
				.get("content") as Y.Text;
			ytext.insert(0, "pen local");
		});

		const originTypes = events.map((event) =>
			getOpOriginType(event.origin),
		);
		expect(originTypes).toContain("user");
		expect(originTypes).not.toContain("unknown");
		expect(originTypes).not.toContain("collaborator");
		expect(events.some((event) => typeof event.origin === "string")).toBe(
			false,
		);
	});

	it("COL1: collaborator and unknown are not in trackedOriginTypes", () => {
		const crdtUndoSource = readFileSync(
			new URL("../undo.ts", import.meta.url),
			"utf8",
		);
		const undoExtensionSource = readFileSync(
			new URL(
				"../../../../extensions/undo/src/undoExtension.ts",
				import.meta.url,
			),
			"utf8",
		);

		expect(crdtUndoSource).toContain(
			'options?.trackedOriginTypes ?? ["user", "ai"]',
		);
		expect(crdtUndoSource).not.toMatch(
			/trackedOriginTypes \?\? \[[^\]]*(collaborator|unknown)/,
		);
		expect(undoExtensionSource).toMatch(
			/const DEFAULT_TRACKED_ORIGINS: OpOrigin\[] = \[\s*"user",\s*"ai",\s*"import",\s*"input-rule",\s*]/,
		);
		expect(undoExtensionSource).not.toMatch(
			/DEFAULT_TRACKED_ORIGINS: OpOrigin\[] = \[[^\]]*(collaborator|unknown)/,
		);
	});

	it("COL1: remote applyUpdate does not enter the local undo stack", () => {
		const peerA = createPeerDoc(adapter, 1);
		const peerB = createPeerDoc(adapter, 2);
		const localText = seedParagraph(peerA);
		adapter.applyUpdate(peerB, adapter.encodeState(peerA));
		expect(
			(
				peerB.penDocument.blocks
					.get("block-1")!
					.get("content") as Y.Text
			).toString(),
		).toBe(localText.toString());

		const undo = createYjsUndoManager(peerA);
		expect(undo.canUndo()).toBe(false);

		const remoteText = peerB.penDocument.blocks
			.get("block-1")!
			.get("content") as Y.Text;
		peerB.ydoc.transact(() => {
			remoteText.insert(0, "from B");
		}, "user");
		adapter.applyUpdate(
			peerA,
			Y.encodeStateAsUpdate(peerB.ydoc, Y.encodeStateVector(peerA.ydoc)),
		);

		expect(remoteText.toString()).toBe("from B");
		expect(localText.toString()).toBe("from B");
		expect(undo.canUndo()).toBe(false);
	});
});
