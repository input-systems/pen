/**
 * Central AX6 `prefers-reduced-motion` flag, one shared signal per editor
 * root (`getRootReducedMotion`). Do not add per-feature media queries (this
 * file is the only site).
 *
 * AX6 mapping when `reduced` is true:
 * - caret blink → solid (pen-dom overlay controller)
 * - transitions → instant: the field editor reflects the signal as
 *   `data-pen-reduced-motion` on the root, which the AI suggestion underline
 *   selects on; React hosts read it through `useReducedMotion`
 * - shimmer → static badge: the library ships no shimmer, so this binds host
 *   code reading the same signal
 *
 * HOST4: missing `matchMedia` → `reduced=false` (animations stay on).
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Presence-only root attribute (HOST6) set while the root's signal is reduced. */
export const REDUCED_MOTION_ATTR = "data-pen-reduced-motion";

/** AX6 mapping overlay/paint must apply when `reduced` is true. */
export const AX6_MOTION_MAPPING = {
	caretBlink: "solid",
	shimmer: "static-badge",
	transitions: "instant",
} as const;

type Ax6MotionMapping = typeof AX6_MOTION_MAPPING;

export type ReducedMotionListener = () => void;

export interface ReducedMotionSignal {
	readonly reduced: boolean;
	subscribe(listener: ReducedMotionListener): () => void;
	dispose(): void;
}

export function createReducedMotionSignal(
	root?: ParentNode,
): ReducedMotionSignal {
	const matchMedia = resolveMatchMedia(root);
	const mediaQuery = matchMedia?.(REDUCED_MOTION_QUERY);
	let current = mediaQuery?.matches ?? false;
	let disposed = false;
	const listeners = new Set<ReducedMotionListener>();

	const onChange = (event: MediaQueryListEvent): void => {
		if (event.matches === current) {
			return;
		}
		current = event.matches;
		for (const listener of [...listeners]) {
			listener();
		}
	};

	mediaQuery?.addEventListener("change", onChange);

	return {
		get reduced() {
			return current;
		},
		subscribe(listener) {
			if (disposed) {
				return () => {};
			}
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			listeners.clear();
			mediaQuery?.removeEventListener("change", onChange);
		},
	};
}

type SharedRootSignal = {
	readonly signal: ReducedMotionSignal;
	refs: number;
};

const rootSignals = new WeakMap<HTMLElement, SharedRootSignal>();

/**
 * The root's one reduced-motion signal, shared by the overlay, the root
 * attribute and bindings so they read the same value. Each call returns a
 * handle; `dispose()` releases it and its subscriptions, and the last
 * release stops listening to `matchMedia`.
 */
export function getRootReducedMotion(root: HTMLElement): ReducedMotionSignal {
	let shared = rootSignals.get(root);
	if (!shared) {
		shared = { signal: createReducedMotionSignal(root), refs: 0 };
		rootSignals.set(root, shared);
	}
	shared.refs += 1;
	const entry = shared;
	const unsubscribers = new Set<() => void>();
	let released = false;

	return {
		get reduced() {
			return entry.signal.reduced;
		},
		subscribe(listener) {
			if (released) {
				return () => {};
			}
			const unsubscribe = entry.signal.subscribe(listener);
			unsubscribers.add(unsubscribe);
			return () => {
				unsubscribers.delete(unsubscribe);
				unsubscribe();
			};
		},
		dispose() {
			if (released) {
				return;
			}
			released = true;
			for (const unsubscribe of unsubscribers) {
				unsubscribe();
			}
			unsubscribers.clear();
			entry.refs -= 1;
			if (entry.refs === 0) {
				entry.signal.dispose();
				rootSignals.delete(root);
			}
		},
	};
}

type MatchMediaView = {
	matchMedia: (query: string) => MediaQueryList;
};

function resolveView(root?: ParentNode): unknown {
	if (root === undefined) {
		return globalThis;
	}
	if (root.nodeType === 9) {
		return (root as Document).defaultView;
	}
	return (root as Node).ownerDocument?.defaultView;
}

function resolveMatchMedia(
	root?: ParentNode,
): ((query: string) => MediaQueryList) | undefined {
	const view = resolveView(root);
	if (
		view == null ||
		typeof view !== "object" ||
		typeof (view as MatchMediaView).matchMedia !== "function"
	) {
		return undefined;
	}

	return (view as MatchMediaView).matchMedia.bind(view);
}
