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
		reducedMotionSubscriber(rootElement),
		() => readReducedMotion(rootElement),
		() => false,
	);
}

type Subscribe = (onChange: () => void) => () => void;

/**
 * One subscribe function per root. `useSyncExternalStore` resubscribes
 * whenever the function's identity changes, and an inline one changes every
 * render: the sole holder of a root's signal then disposed it and re-added
 * its `matchMedia` listener on each render. The identity is a stability
 * contract with `useSyncExternalStore`, not an optimisation, so it is kept
 * per root here rather than left to the compiler.
 */
const subscribersByRoot = new WeakMap<HTMLElement, Subscribe>();

function reducedMotionSubscriber(root: HTMLElement | null): Subscribe {
	if (!root) {
		return subscribeNothing;
	}
	let subscribe = subscribersByRoot.get(root);
	if (!subscribe) {
		subscribe = (onChange) => subscribeReducedMotion(root, onChange);
		subscribersByRoot.set(root, subscribe);
	}
	return subscribe;
}

function subscribeNothing(): () => void {
	return noop;
}

function subscribeReducedMotion(
	root: HTMLElement,
	onChange: () => void,
): () => void {
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
