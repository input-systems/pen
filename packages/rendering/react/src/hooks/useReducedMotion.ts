import { useContext, useSyncExternalStore } from "react";
import { getRootReducedMotion } from "@input/pen-dom";
import { EditorRegionSelectionContext } from "../primitives/editor/regionSelectionState";

/**
 * The editor root's AX6 reduced-motion signal (`getRootReducedMotion`), so
 * host transitions and animations follow the same value as the overlay
 * caret. False outside `Pen.Editor.Root`, before the root mounts, and during
 * SSR (HOST5).
 */
export function useReducedMotion(): boolean {
	const rootElement =
		useContext(EditorRegionSelectionContext)?.rootElement ?? null;
	return useSyncExternalStore(
		(onChange) => subscribeReducedMotion(rootElement, onChange),
		() => readReducedMotion(rootElement),
		() => false,
	);
}

function subscribeReducedMotion(
	root: HTMLElement | null,
	onChange: () => void,
): () => void {
	if (!root) {
		return noop;
	}
	const signal = getRootReducedMotion(root);
	const unsubscribe = signal.subscribe(onChange);
	return () => {
		unsubscribe();
		signal.dispose();
	};
}

function readReducedMotion(root: HTMLElement | null): boolean {
	if (!root) {
		return false;
	}
	const signal = getRootReducedMotion(root);
	const reduced = signal.reduced;
	signal.dispose();
	return reduced;
}

function noop(): void {}
