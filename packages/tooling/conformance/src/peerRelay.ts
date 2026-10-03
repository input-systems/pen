import type { Page } from "@playwright/test";

/**
 * Two-page relay (W5.R10, W5.G3): every Yjs update between real editors
 * goes through a queue the test controls. Latency and reordering are counts,
 * not clocks: an update is "held" until the test releases it, and no relay
 * code uses a timer.
 */

export type RelayOrder = "fifo" | "reverse" | { readonly seed: number };

export interface HeldUpdate {
	readonly from: string;
	readonly to: string;
	readonly update: Uint8Array;
	/** Scenario steps this update has been held for. */
	readonly heldSteps: number;
}

/** Realm-free queue, shared by the two-page relay and the in-page fuzz relay (W5.G7). */
export interface UpdateQueue {
	/** Holds one copy of `update` for every other peer. */
	enqueue(from: string, update: Uint8Array): void;
	/** One scenario step: ages every held update. */
	step(): void;
	held(to?: string): number;
	/** Removes and returns held updates, to `to` only when given, in `order`, at most `count`. */
	release(options?: {
		readonly to?: string;
		readonly order?: RelayOrder;
		readonly count?: number;
	}): HeldUpdate[];
	/** Discards held updates; the caller follows with a state-vector resync. */
	drop(to?: string): number;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function ordered(items: HeldUpdate[], order: RelayOrder): HeldUpdate[] {
	if (order === "fifo") return items;
	if (order === "reverse") return [...items].reverse();
	const random = mulberry32(order.seed);
	const shuffled = [...items];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1));
		[shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
	}
	return shuffled;
}

export function createUpdateQueue(peers: readonly string[]): UpdateQueue {
	let held: HeldUpdate[] = [];
	return {
		enqueue(from, update) {
			for (const to of peers) {
				if (to !== from) {
					held.push({ from, to, update, heldSteps: 0 });
				}
			}
		},
		step() {
			held = held.map((entry) => ({ ...entry, heldSteps: entry.heldSteps + 1 }));
		},
		held(to) {
			return to === undefined ? held.length : held.filter((entry) => entry.to === to).length;
		},
		release(options = {}) {
			const matching = held.filter(
				(entry) => options.to === undefined || entry.to === options.to,
			);
			const chosen = ordered(matching, options.order ?? "fifo").slice(
				0,
				options.count ?? matching.length,
			);
			const released = new Set(chosen);
			held = held.filter((entry) => !released.has(entry));
			return chosen;
		},
		drop(to) {
			const before = held.length;
			held = held.filter((entry) => to !== undefined && entry.to !== to);
			return before - held.length;
		},
	};
}

export interface PagePeer {
	readonly id: string;
	readonly page: Page;
}

export interface PageRelay {
	mode(): "live" | "hold";
	/** Pumped updates stay queued until released. */
	hold(): void;
	/** Releases everything fifo, then delivers on every pump. */
	live(): Promise<void>;
	/** Drains every page's outbox into the queue, and delivers it when live. */
	pump(): Promise<void>;
	/** Pumps, then delivers held updates; returns how many were delivered. */
	release(options?: {
		readonly to?: string;
		readonly order?: RelayOrder;
		readonly count?: number;
	}): Promise<number>;
	/** Sends `to` everything every other peer holds that `to` lacks. */
	resync(to: string): Promise<void>;
	/** Awareness is always live; it is not what the relay tests. */
	pumpAwareness(): Promise<void>;
	readonly queue: UpdateQueue;
}

function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function fromBase64(text: string): Uint8Array {
	return new Uint8Array(Buffer.from(text, "base64"));
}

export function createPageRelay(
	peers: readonly PagePeer[],
	queue: UpdateQueue = createUpdateQueue(peers.map((peer) => peer.id)),
): PageRelay {
	let mode: "live" | "hold" = "live";
	const byId = new Map(peers.map((peer) => [peer.id, peer]));

	const deliver = async (entries: readonly HeldUpdate[]): Promise<number> => {
		const grouped = new Map<string, string[]>();
		for (const entry of entries) {
			const list = grouped.get(entry.to) ?? [];
			list.push(toBase64(entry.update));
			grouped.set(entry.to, list);
		}
		for (const [to, updates] of grouped) {
			await byId.get(to)!.page.evaluate(
				(list) => window.__penConformance.relay!.deliver(list),
				updates,
			);
		}
		return entries.length;
	};

	const drainAll = async (): Promise<void> => {
		for (const peer of peers) {
			const drained = await peer.page.evaluate(() =>
				window.__penConformance.relay!.drainOutbox(),
			);
			for (const update of drained) {
				queue.enqueue(peer.id, fromBase64(update));
			}
		}
	};

	const relay: PageRelay = {
		queue,
		mode: () => mode,
		hold() {
			mode = "hold";
		},
		async live() {
			mode = "live";
			await relay.pump();
		},
		async pump() {
			await drainAll();
			if (mode === "live") {
				await deliver(queue.release({ order: "fifo" }));
			}
		},
		async release(options) {
			await drainAll();
			return deliver(queue.release(options));
		},
		async resync(to) {
			const target = byId.get(to)!;
			const stateVector = await target.page.evaluate(() =>
				window.__penConformance.relay!.stateVector(),
			);
			for (const peer of peers) {
				if (peer.id === to) continue;
				const update = await peer.page.evaluate(
					(sv) => window.__penConformance.relay!.encodeSince(sv),
					stateVector,
				);
				await target.page.evaluate(
					(list) => window.__penConformance.relay!.deliver(list),
					[update],
				);
			}
		},
		async pumpAwareness() {
			for (const peer of peers) {
				const updates = await peer.page.evaluate(() =>
					window.__penConformance.relay!.drainAwareness(),
				);
				if (updates.length === 0) continue;
				for (const other of peers) {
					if (other.id === peer.id) continue;
					await other.page.evaluate(
						(list) => window.__penConformance.relay!.deliverAwareness(list),
						updates,
					);
				}
			}
		},
	};
	return relay;
}
