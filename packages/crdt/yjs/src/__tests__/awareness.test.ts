import { describe, expect, it } from "vitest";

import { yjsAdapter } from "../adapter";
import { createYjsDocument } from "../document";
import {
	applyYjsAwarenessUpdate,
	createYjsAwareness,
	encodeYjsAwarenessUpdate,
} from "../awareness";
import { createPeerDoc } from "./createPeerDoc";

describe("awareness", () => {
	const adapter = yjsAdapter();

	it("setLocalState and getStates include local client", () => {
		const doc = createYjsDocument(adapter);
		const awareness = createYjsAwareness(doc);

		awareness.setLocalState({ cursor: { blockId: "b1", offset: 5 } });
		const states = awareness.getStates();
		expect(states.size).toBeGreaterThanOrEqual(1);

		const localState = awareness.getLocalState();
		expect(localState).toEqual({ cursor: { blockId: "b1", offset: 5 } });

		awareness.destroy();
	});

	it("on('change') fires when state changes", () => {
		const doc = createYjsDocument(adapter);
		const awareness = createYjsAwareness(doc);

		const changes: unknown[] = [];
		const cb = (event: unknown) => changes.push(event);

		awareness.on("change", cb);
		awareness.setLocalState({ cursor: { blockId: "b1", offset: 0 } });

		expect(changes.length).toBeGreaterThanOrEqual(1);

		awareness.off("change", cb);
		awareness.destroy();
	});

	it("off('change') removes the listener", () => {
		const doc = createYjsDocument(adapter);
		const awareness = createYjsAwareness(doc);

		const changes: unknown[] = [];
		const cb = (event: unknown) => changes.push(event);

		awareness.on("change", cb);
		awareness.off("change", cb);

		awareness.setLocalState({ cursor: { blockId: "b2", offset: 0 } });
		expect(changes).toHaveLength(0);

		awareness.destroy();
	});

	it("destroy cleans up the awareness instance", () => {
		const doc = createYjsDocument(adapter);
		const awareness = createYjsAwareness(doc);

		const changes: unknown[] = [];
		awareness.on("change", (event) => changes.push(event));
		awareness.setLocalState({ initial: true });
		expect(changes.length).toBeGreaterThanOrEqual(1);

		awareness.destroy();
		const afterDestroy = changes.length;

		try {
			awareness.setLocalState({ after: true });
		} catch {
			// destroyed instances may reject later writes
		}

		expect(changes.length).toBe(afterDestroy);
		expect(awareness.getLocalState()).not.toEqual({ after: true });
	});

	it("encodes and applies awareness updates across instances", () => {
		const sourceDoc = createPeerDoc(adapter, 1);
		const targetDoc = createPeerDoc(adapter, 2);
		const sourceAwareness = createYjsAwareness(sourceDoc);
		const targetAwareness = createYjsAwareness(targetDoc);

		sourceAwareness.setLocalState({
			user: { id: "u1", name: "Ada" },
			cursor: { blockId: "b1", offset: 2 },
		});
		const update = encodeYjsAwarenessUpdate(
			sourceAwareness,
			Array.from(sourceAwareness.getStates().keys()),
		);

		applyYjsAwarenessUpdate(targetAwareness, update);

		expect(Array.from(targetAwareness.getStates().values())).toContainEqual(
			expect.objectContaining({
				user: { id: "u1", name: "Ada" },
				cursor: { blockId: "b1", offset: 2 },
			}),
		);
	});
});
