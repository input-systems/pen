/**
 * AX2: one visually-hidden live region per editor root.
 * Rate-limit one per key per 500ms, latest wins.
 *
 * Each announcement is one write job (`aria-live` + textContent) passed to
 * `options.schedule`; the editor binding runs it in the DomScheduler write
 * phase, the default runs it synchronously. Construction of the region is
 * synchronous — the node must exist before the first announce. The
 * focus-sink writes in focusSink.ts are likewise not schedulable; do not
 * convert them along with this file.
 *
 * ARIA booleans stay the literal strings "true"/"false". Do not apply
 * the data-* present/absent spelling to `aria-atomic` (or any ARIA
 * boolean). `aria-live` is a token (`polite`/`assertive`), not a boolean.
 */

import { hideVisually } from "./hideVisually";

export const ANNOUNCE_RATE_LIMIT_MS = 500;

export type AnnouncerPriority = "polite" | "assertive";

export interface Announcer {
	announce(message: string, priority?: AnnouncerPriority, key?: string): void;
	dispose(): void;
}

type PendingWrite = {
	message: string;
	priority: AnnouncerPriority;
};

type KeyGate = {
	lastWrittenAt: number;
	timeout: ReturnType<typeof setTimeout> | undefined;
	pending: PendingWrite | undefined;
};

export interface AnnouncerOptions {
	/** Where the live region mounts. A Document mounts on body. */
	readonly root?: ParentNode;
	/** Runs one region write. Default: synchronously (headless tests, hosts without a scheduler). */
	readonly schedule?: (write: () => void) => void;
	/** Rate-limit clock. Default: `Date.now`. */
	readonly now?: () => number;
}

const runNow = (write: () => void): void => write();

export function createAnnouncer(options: AnnouncerOptions = {}): Announcer {
	const { root } = options;
	const schedule = options.schedule ?? runNow;
	const now = options.now ?? Date.now;
	const doc = resolveDocument(root);
	const region = doc ? createLiveRegion(doc, root) : null;
	const gates = new Map<string, KeyGate>();
	let disposed = false;

	/** One queued job; a job queued before `dispose` writes nothing. */
	const queueWrite = (message: string, priority: AnnouncerPriority): void => {
		schedule(() => {
			if (!disposed) {
				write(region, message, priority);
			}
		});
	};

	const flushPending = (gate: KeyGate): void => {
		gate.timeout = undefined;
		const pending = gate.pending;
		gate.pending = undefined;
		if (pending === undefined || disposed) {
			return;
		}
		gate.lastWrittenAt = now();
		queueWrite(pending.message, pending.priority);
	};

	return {
		announce(message, priority = "polite", key = message) {
			if (disposed || region === null) {
				return;
			}

			const at = now();
			let gate = gates.get(key);
			if (gate === undefined) {
				gate = {
					lastWrittenAt: 0,
					timeout: undefined,
					pending: undefined,
				};
				gates.set(key, gate);
			}

			if (
				gate.lastWrittenAt === 0 ||
				at - gate.lastWrittenAt >= ANNOUNCE_RATE_LIMIT_MS
			) {
				gate.lastWrittenAt = at;
				queueWrite(message, priority);
				return;
			}

			// The rate limit is milliseconds (AX2), and this is not a
			// selection path (S4): the expiry timer stays, and it schedules.
			gate.pending = { message, priority };
			if (gate.timeout === undefined) {
				gate.timeout = setTimeout(
					() => flushPending(gate),
					ANNOUNCE_RATE_LIMIT_MS - (at - gate.lastWrittenAt),
				);
			}
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			for (const gate of gates.values()) {
				if (gate.timeout !== undefined) {
					clearTimeout(gate.timeout);
					gate.timeout = undefined;
				}
			}
			gates.clear();
			region?.remove();
		},
	};
}

function write(
	region: HTMLElement | null,
	message: string,
	priority: AnnouncerPriority,
): void {
	if (region === null) {
		return;
	}
	region.setAttribute("aria-live", priority);
	region.textContent = "";
	region.textContent = message;
}

function createLiveRegion(
	doc: Document,
	root?: ParentNode,
): HTMLElement | null {
	const mount = resolveMount(root, doc);
	if (mount === undefined) {
		return null;
	}

	const region = doc.createElement("div");
	// construction of the live region, not a scheduled paint write
	region.setAttribute("role", "status");
	region.setAttribute("aria-live", "polite");
	// ARIA boolean: literal "true". `aria-atomic=""` is invalid.
	region.setAttribute("aria-atomic", "true");
	hideVisually(region);
	mount.appendChild(region);
	return region;
}

function resolveDocument(root?: ParentNode): Document | undefined {
	if (root === undefined) {
		const doc = (globalThis as { document?: Document }).document;
		return typeof doc?.createElement === "function" ? doc : undefined;
	}
	if (root.nodeType === 9) {
		return root as Document;
	}
	return root.ownerDocument ?? undefined;
}

function resolveMount(
	root: ParentNode | undefined,
	doc: Document,
): ParentNode | undefined {
	if (root !== undefined && root.nodeType !== 9) {
		return root;
	}
	return doc.body ?? doc.documentElement ?? undefined;
}
