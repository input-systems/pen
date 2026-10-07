// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindEditorRootFocus } from "../host/rootFocusTracking";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe("root focus initialization", () => {
	it.each([
		["inside an active window", true, true],
		["outside the root", false, true],
		["inside an inactive window", true, false],
	] as const)(
		"AX1, O5: reports focus %s on bind without replaying entry",
		(_name, inside, windowFocused) => {
			const root = document.createElement("div");
			const inner = document.createElement("button");
			const outside = document.createElement("button");
			root.append(inner);
			document.body.append(root, outside);
			(inside ? inner : outside).focus();
			vi.spyOn(document, "hasFocus").mockReturnValue(windowFocused);
			const onFocusChange = vi.fn();
			const onFocusIn = vi.fn();

			cleanups.push(
				bindEditorRootFocus(root, { onFocusChange, onFocusIn }),
			);

			expect(onFocusChange).toHaveBeenCalledExactlyOnceWith(
				inside && windowFocused,
			);
			expect(onFocusIn).not.toHaveBeenCalled();
		},
	);
});
