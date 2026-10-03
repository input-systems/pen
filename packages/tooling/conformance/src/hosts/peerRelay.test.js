import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";

import { createUpdateQueue } from "../peerRelay.ts";

/**
 * W5.R10: the relay queue over two real `Y.Doc`s. Delivery copies the
 * `connectPeers` pattern: the update arrives, and both a no-op relay and an
 * echoing relay are caught.
 */

const RELAY_ORIGIN = Symbol("relay");

function pairWithOutboxes() {
	const a = new Y.Doc({ gc: false });
	const b = new Y.Doc({ gc: false });
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	const outbox = { a: [], b: [] };
	a.on("update", (update, origin) => {
		if (origin !== RELAY_ORIGIN) outbox.a.push(update);
	});
	b.on("update", (update, origin) => {
		if (origin !== RELAY_ORIGIN) outbox.b.push(update);
	});
	const docs = { a, b };
	const queue = createUpdateQueue(["a", "b"]);
	const pump = () => {
		for (const id of ["a", "b"]) {
			for (const update of outbox[id].splice(0)) queue.enqueue(id, update);
		}
	};
	const deliver = (entries) => {
		for (const entry of entries) Y.applyUpdate(docs[entry.to], entry.update, RELAY_ORIGIN);
	};
	return { a, b, queue, pump, deliver, outbox };
}

test("peerRelay: a held update is delivered only on release", () => {
	const { a, b, queue, pump, deliver } = pairWithOutboxes();
	a.getText("t").insert(0, "from-a");
	pump();
	queue.step();
	assert.equal(b.getText("t").toString(), "");
	assert.equal(queue.held("b"), 1);
	const released = queue.release({ to: "b" });
	assert.equal(released[0].heldSteps, 1);
	deliver(released);
	assert.equal(b.getText("t").toString(), "from-a");
	assert.equal(queue.held(), 0);
});

test("peerRelay: reverse release still converges", () => {
	const { a, b, queue, pump, deliver } = pairWithOutboxes();
	for (const chunk of ["one ", "two ", "three"]) {
		const text = b.getText("t");
		text.insert(text.length, chunk);
		pump();
	}
	a.getText("t").insert(0, "A:");
	pump();
	deliver(queue.release({ to: "a", order: "reverse" }));
	deliver(queue.release({ to: "b", order: { seed: 7 } }));
	assert.equal(a.getText("t").toString(), b.getText("t").toString());
	assert.match(a.getText("t").toString(), /one two three/);
});

test("peerRelay no-op would drop the update", () => {
	const { a, b, queue, pump } = pairWithOutboxes();
	a.getText("t").insert(0, "from-a");
	pump();
	const released = queue.release({ to: "b" });
	const noop = () => {};
	noop(released);
	assert.equal(b.getText("t").toString(), "");
});

test("peerRelay echo would duplicate the update", () => {
	const { a, b, queue, pump, outbox } = pairWithOutboxes();
	a.getText("t").insert(0, "x");
	pump();
	// A relay that applies without its origin re-emits the update to b's
	// outbox, so the next pump would send a's own update back to a.
	for (const entry of queue.release({ to: "b" })) Y.applyUpdate(b, entry.update);
	assert.equal(outbox.b.length, 1);
	pump();
	assert.equal(queue.held("a"), 1);
});
