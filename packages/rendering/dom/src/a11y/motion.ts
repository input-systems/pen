/**
 * Central AX6 `prefers-reduced-motion` flag. The overlay controller
 * (`overlay/overlayController.ts`) reads `reduced` once per root and paints
 * a solid caret (`AX6_MOTION_MAPPING.caretBlink`).
 * Do not add per-feature media queries (this file is the only site).
 *
 * AX6 mapping when `reduced` is true:
 * - caret blink → solid (pen-dom overlay controller)
 * - shimmer → static badge (not consumed yet)
 * - transitions → instant (not consumed yet)
 *
 * HOST4: missing `matchMedia` → `reduced=false` (animations stay on).
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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
