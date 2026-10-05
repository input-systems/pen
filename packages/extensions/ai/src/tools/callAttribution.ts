import type { OpOrigin } from "@input/pen-types";

import type { AIToolTurn } from "./authority";

/** One open tool call, as the write guard sees it (AIB3). */
export interface GuardedCall {
	readonly mutating: boolean;
	readonly turn?: AIToolTurn;
	readonly onReadOnlyMutation: () => void;
}

/** Marks a nested write that a guard already accounted for (staging). */
const PASS_THROUGH = Symbol("pass-through");

type AttributionFrame = GuardedCall | typeof PASS_THROUGH;

interface CallRegistry {
	/** Open calls, in open order. */
	readonly live: GuardedCall[];
	/** The calls whose code is on the synchronous stack, innermost last. */
	readonly frames: AttributionFrame[];
}

/**
 * Who a write belongs to:
 * - `none` — no call is open, or a guard already accounted for it; it runs
 *   unguarded.
 * - `call` — this call issued it, or it is the only call open.
 * - `refused` — no call can be named and a read-only call is open; it is
 *   refused and reported against every open read-only call.
 */
export type WriteOwner =
	| { readonly kind: "none" }
	| { readonly kind: "call"; readonly call: GuardedCall }
	| { readonly kind: "refused"; readonly readOnly: readonly GuardedCall[] };

const NO_OWNER: WriteOwner = { kind: "none" };

const registries = new WeakMap<object, CallRegistry>();

function registryFor(editor: object): CallRegistry {
	let registry = registries.get(editor);
	if (!registry) {
		registry = { live: [], frames: [] };
		registries.set(editor, registry);
	}
	return registry;
}

/** Registers `call` as open on `editor` until the returned release runs. */
export function openGuardedCallRecord(
	editor: object,
	call: GuardedCall,
): () => void {
	const registry = registryFor(editor);
	registry.live.push(call);
	return () => {
		const index = registry.live.indexOf(call);
		if (index >= 0) {
			registry.live.splice(index, 1);
		}
	};
}

function runInFrame<R>(
	editor: object,
	frame: AttributionFrame,
	run: () => R,
): R {
	const { frames } = registryFor(editor);
	frames.push(frame);
	try {
		return run();
	} finally {
		frames.pop();
	}
}

/** Runs `run` with its writes attributed to `call`. */
export function runAsCall<R>(
	editor: object,
	call: GuardedCall,
	run: () => R,
): R {
	return runInFrame(editor, call, run);
}

/** Runs `run` with its writes passing every guard. */
export function runPastGuards<R>(editor: object, run: () => R): R {
	return runInFrame(editor, PASS_THROUGH, run);
}

/** Origin types a tool call's own writes carry. */
const AI_ORIGIN_TYPES: ReadonlySet<string> = new Set(["ai", "ai-session"]);

function isAIOrigin(origin: OpOrigin): boolean {
	return AI_ORIGIN_TYPES.has(typeof origin === "string" ? origin : origin.type);
}

/**
 * Names the call a write on `editor` belongs to (AIB3). A call's own code is
 * on the synchronous stack whenever it writes through its call view, so that
 * frame decides. A write with no open call's frame that names a non-AI
 * origin — the user typing, undo, an input rule — is no call's and runs
 * unguarded. An unframed AI write that carries an open mutating call's
 * group — a stream writer's timed flush, which no frame covers — is that
 * call's. Any other unframed write — a handler that captured the shared
 * editor — belongs to the only open call; with several open it cannot be
 * attributed, so it is refused while any of them is read-only and otherwise
 * goes to the newest mutating call.
 */
export function resolveWriteOwner(
	editor: object,
	origin?: OpOrigin,
): WriteOwner {
	const registry = registries.get(editor);
	if (!registry) {
		return NO_OWNER;
	}
	const frame = registry.frames[registry.frames.length - 1];
	if (frame === PASS_THROUGH) {
		return NO_OWNER;
	}
	if (frame && registry.live.includes(frame)) {
		return { kind: "call", call: frame };
	}
	if (origin !== undefined && !isAIOrigin(origin)) {
		return NO_OWNER;
	}
	const { live } = registry;
	if (live.length === 0) {
		return NO_OWNER;
	}
	const grouped = groupOwner(live, origin);
	if (grouped) {
		return { kind: "call", call: grouped };
	}
	if (live.length === 1) {
		return { kind: "call", call: live[0] };
	}
	const readOnly = live.filter((call) => !call.mutating);
	if (readOnly.length > 0) {
		return { kind: "refused", readOnly };
	}
	return { kind: "call", call: live[live.length - 1] };
}

/**
 * The newest open mutating call whose turn's group `origin` carries. A
 * read-only call cannot own a stream writer (opening one is refused), so
 * only mutating calls are candidates; calls of one turn share its group and
 * its undo step, so the newest stands for them.
 */
function groupOwner(
	live: readonly GuardedCall[],
	origin: OpOrigin | undefined,
): GuardedCall | undefined {
	const groupId = typeof origin === "object" ? origin.groupId : undefined;
	if (groupId === undefined) {
		return undefined;
	}
	for (let index = live.length - 1; index >= 0; index -= 1) {
		const call = live[index]!;
		if (call.mutating && call.turn?.groupId === groupId) {
			return call;
		}
	}
	return undefined;
}

/** Reports a refused write against the call(s) it belongs to. */
export function reportRefusedWrite(
	owner: Exclude<WriteOwner, { kind: "none" }>,
): void {
	if (owner.kind === "call") {
		owner.call.onReadOnlyMutation();
		return;
	}
	for (const call of owner.readOnly) {
		call.onReadOnlyMutation();
	}
}

type AnyFunction = (...args: unknown[]) => unknown;

function isFixedProperty(object: object, key: PropertyKey): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(object, key);
	return (
		descriptor !== undefined &&
		!descriptor.configurable &&
		descriptor.writable === false
	);
}

interface ViewHooks {
	/** Replaces a non-function property read through the view. */
	readonly property?: (key: PropertyKey, value: unknown) => unknown;
	/** Replaces what a method called through the view returns. */
	readonly result?: (
		key: PropertyKey,
		args: readonly unknown[],
		value: unknown,
	) => unknown;
}

/**
 * A view of `target` whose methods run attributed to `call`: every write
 * they make, however deep, is the call's (AIB3). Methods run against
 * `target` itself, so private state and identity checks are unaffected.
 */
export function createCallView<T extends object>(
	editor: object,
	call: GuardedCall,
	target: T,
	hooks: ViewHooks = {},
): T {
	const methods = new Map<
		PropertyKey,
		{ readonly method: AnyFunction; readonly view: AnyFunction }
	>();
	return new Proxy(target, {
		get(object, key) {
			const value: unknown = Reflect.get(object, key, object);
			if (isFixedProperty(object, key)) {
				// A proxy must report a frozen property as is.
				return value;
			}
			if (typeof value !== "function") {
				return hooks.property ? hooks.property(key, value) : value;
			}
			const method = value as AnyFunction;
			const cached = methods.get(key);
			if (cached?.method === method) {
				return cached.view;
			}
			const view = (...args: unknown[]) => {
				const returned = runAsCall(editor, call, () =>
					method.apply(object, args),
				);
				return hooks.result ? hooks.result(key, args, returned) : returned;
			};
			methods.set(key, { method, view });
			return view;
		},
	});
}
