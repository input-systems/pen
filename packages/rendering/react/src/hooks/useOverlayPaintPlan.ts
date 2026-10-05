import { useSyncExternalStore } from "react";
import type { OverlayPaintPlan, RootOverlay } from "@input/pen-dom";

/**
 * The root overlay's last painted plan (OV3). The plan keeps its identity
 * while nothing changes, so a binding re-renders only when pen-dom paints
 * something new. Null before the first paint or without an overlay.
 */
export function useOverlayPaintPlan(
	overlay: RootOverlay | null,
): OverlayPaintPlan | null {
	return useSyncExternalStore(
		(onChange) => overlay?.onPaintPlan(onChange) ?? noop,
		() => overlay?.plan ?? null,
		() => null,
	);
}

function noop(): void {}
