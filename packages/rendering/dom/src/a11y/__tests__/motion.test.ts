// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AX6_MOTION_MAPPING,
	REDUCED_MOTION_QUERY,
	createReducedMotionSignal,
	getRootReducedMotion,
} from "../motion";

type MockMediaQueryList = {
	matches: boolean;
	addEventListener: (
		type: string,
		listener: (event: MediaQueryListEvent) => void,
	) => void;
	removeEventListener: (
		type: string,
		listener: (event: MediaQueryListEvent) => void,
	) => void;
	dispatch: (matches: boolean) => void;
};

function createMockMediaQueryList(matches: boolean): MockMediaQueryList {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const mediaQueryList: MockMediaQueryList = {
		matches,
		addEventListener(type, listener) {
			if (type === "change") {
				listeners.add(listener);
			}
		},
		removeEventListener(type, listener) {
			if (type === "change") {
				listeners.delete(listener);
			}
		},
		dispatch(nextMatches) {
			mediaQueryList.matches = nextMatches;
			const event = { matches: nextMatches } as MediaQueryListEvent;
			for (const listener of listeners) {
				listener(event);
			}
		},
	};
	return mediaQueryList;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("createReducedMotionSignal (AX6)", () => {
	it.each([true, false])(
		"AX6: reduced mirrors a media query match of %s",
		(matches) => {
			const mediaQueryList = createMockMediaQueryList(matches);
			vi.stubGlobal("matchMedia", () => mediaQueryList);

			const signal = createReducedMotionSignal();
			expect(signal.reduced).toBe(matches);
			signal.dispose();
		},
	);

	it("AX6 HOST4: missing matchMedia leaves reduced false", () => {
		vi.stubGlobal("matchMedia", undefined);

		const signal = createReducedMotionSignal();
		expect(signal.reduced).toBe(false);
		signal.dispose();
	});

	it("AX6: uses the single central media query", () => {
		const queries: string[] = [];
		vi.stubGlobal("matchMedia", (query: string) => {
			queries.push(query);
			return createMockMediaQueryList(false);
		});

		const signal = createReducedMotionSignal();
		expect(queries).toEqual([REDUCED_MOTION_QUERY]);
		signal.dispose();
	});

	it("AX6: subscribe is notified when the preference changes", () => {
		const mediaQueryList = createMockMediaQueryList(false);
		vi.stubGlobal("matchMedia", () => mediaQueryList);

		const signal = createReducedMotionSignal();
		const listener = vi.fn();
		signal.subscribe(listener);

		mediaQueryList.dispatch(true);

		expect(signal.reduced).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);
		signal.dispose();
	});

	it("AX6: unsubscribe stops further notifications", () => {
		const mediaQueryList = createMockMediaQueryList(false);
		vi.stubGlobal("matchMedia", () => mediaQueryList);

		const signal = createReducedMotionSignal();
		const listener = vi.fn();
		const unsubscribe = signal.subscribe(listener);
		unsubscribe();

		mediaQueryList.dispatch(true);

		expect(signal.reduced).toBe(true);
		expect(listener).not.toHaveBeenCalled();
		signal.dispose();
	});

	it("AX6: dispose detaches the media listener", () => {
		const mediaQueryList = createMockMediaQueryList(false);
		vi.stubGlobal("matchMedia", () => mediaQueryList);

		const signal = createReducedMotionSignal();
		const listener = vi.fn();
		signal.subscribe(listener);
		signal.dispose();

		mediaQueryList.dispatch(true);

		expect(listener).not.toHaveBeenCalled();
	});

	it("AX6: createReducedMotionSignal is exported from the package entry", async () => {
		const pkg = await import("@input/pen-dom");
		expect(typeof pkg.createReducedMotionSignal).toBe("function");
	});

	it("AX6: maps caret blink to solid, shimmer to a static badge, transitions to instant", () => {
		// caretBlink is consumed by React EditorCaretOverlay; shimmer and
		// transitions are still unclaimed by overlay/paint.
		expect(AX6_MOTION_MAPPING).toEqual({
			caretBlink: "solid",
			shimmer: "static-badge",
			transitions: "instant",
		});
	});

	it("AX6: optional root reads matchMedia from that document's view", () => {
		const mediaQueryList = createMockMediaQueryList(true);
		const matchMedia = vi.fn(() => mediaQueryList);
		const originalView = document.defaultView;
		Object.defineProperty(document, "defaultView", {
			configurable: true,
			value: { matchMedia },
		});

		try {
			const signal = createReducedMotionSignal(document);
			expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
			expect(signal.reduced).toBe(true);
			signal.dispose();
		} finally {
			Object.defineProperty(document, "defaultView", {
				configurable: true,
				value: originalView,
			});
		}
	});
});

describe("getRootReducedMotion (AX6)", () => {
	it("AX6: handles on one root share one matchMedia listener and release it with the last handle; another root gets its own", () => {
		const mediaQueryList = createMockMediaQueryList(false);
		const addListener = vi.spyOn(mediaQueryList, "addEventListener");
		const removeListener = vi.spyOn(mediaQueryList, "removeEventListener");
		vi.stubGlobal("matchMedia", () => mediaQueryList);
		const root = document.createElement("div");

		const first = getRootReducedMotion(root);
		const second = getRootReducedMotion(root);
		expect(addListener).toHaveBeenCalledTimes(1);

		const seen: boolean[] = [];
		second.subscribe(() => seen.push(second.reduced));
		mediaQueryList.dispatch(true);
		expect(first.reduced).toBe(true);
		expect(seen).toEqual([true]);

		second.dispose();
		mediaQueryList.dispatch(false);
		expect(seen).toEqual([true]);
		expect(removeListener).not.toHaveBeenCalled();

		first.dispose();
		expect(removeListener).toHaveBeenCalledTimes(1);

		const other = getRootReducedMotion(document.createElement("div"));
		expect(addListener).toHaveBeenCalledTimes(2);
		other.dispose();
	});
});
