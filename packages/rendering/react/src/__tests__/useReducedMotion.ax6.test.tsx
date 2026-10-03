// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { useReducedMotion } from "../index";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

type ChangeListener = (event: MediaQueryListEvent) => void;

function stubMatchMedia(matches: boolean) {
	const listeners = new Set<ChangeListener>();
	const mediaQueryList = {
		matches,
		addEventListener: (_type: string, listener: ChangeListener) =>
			listeners.add(listener),
		removeEventListener: (_type: string, listener: ChangeListener) =>
			listeners.delete(listener),
	};
	vi.stubGlobal("matchMedia", () => mediaQueryList);
	return {
		set(next: boolean) {
			mediaQueryList.matches = next;
			for (const listener of [...listeners]) {
				listener({ matches: next } as MediaQueryListEvent);
			}
		},
		listenerCount: () => listeners.size,
	};
}

function Probe({ seen }: { seen: boolean[] }) {
	seen.push(useReducedMotion());
	return null;
}

describe("useReducedMotion (AX6)", () => {
	it("AX6: useReducedMotion follows the editor root's signal and releases it on unmount", async () => {
		const media = stubMatchMedia(false);
		const editor = createEditor({ schema: defaultSchema });
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const seen: boolean[] = [];

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
					<Probe seen={seen} />
				</Pen.Editor.Root>,
			);
		});
		expect(seen.at(-1)).toBe(false);

		await act(async () => {
			media.set(true);
		});
		expect(seen.at(-1)).toBe(true);

		await act(async () => {
			root.unmount();
		});
		expect(media.listenerCount()).toBe(0);
	});

	it("AX6: useReducedMotion is false outside an editor root", async () => {
		stubMatchMedia(true);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const seen: boolean[] = [];

		await act(async () => {
			root.render(<Probe seen={seen} />);
		});
		expect(seen.at(-1)).toBe(false);
		await act(async () => {
			root.unmount();
		});
	});
});
