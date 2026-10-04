// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@input/pen-core";
import type * as PenDom from "@input/pen-dom";
import { defaultSchema } from "@input/pen-schema";
import { useReducedMotion } from "../index";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Subscriptions taken on a root's shared signal, by anyone. */
const signalSubscriptions = vi.hoisted(() => ({ count: 0 }));

vi.mock("@input/pen-dom", async (importOriginal) => {
	const actual = await importOriginal<typeof PenDom>();
	return {
		...actual,
		getRootReducedMotion: (root: HTMLElement) => {
			const signal = actual.getRootReducedMotion(root);
			return {
				get reduced() {
					return signal.reduced;
				},
				subscribe(listener: () => void) {
					signalSubscriptions.count += 1;
					return signal.subscribe(listener);
				},
				dispose: () => signal.dispose(),
			};
		},
	};
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

type ChangeListener = (event: MediaQueryListEvent) => void;

function stubMatchMedia(matches: boolean) {
	const listeners = new Set<ChangeListener>();
	let adds = 0;
	const mediaQueryList = {
		matches,
		addEventListener: (_type: string, listener: ChangeListener) => {
			adds += 1;
			listeners.add(listener);
		},
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
		addCount: () => adds,
	};
}

function Probe({ seen }: { seen: boolean[]; pass?: number }) {
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

	it("AX6: useReducedMotion keeps one media subscription across re-renders", async () => {
		const media = stubMatchMedia(false);
		const editor = createEditor({ schema: defaultSchema });
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const seen: boolean[] = [];
		const render = (pass: number) => (
			<Pen.Editor.Root editor={editor}>
				<Probe key="probe" seen={seen} pass={pass} />
			</Pen.Editor.Root>
		);

		await act(async () => {
			root.render(render(0));
		});
		const adds = media.addCount();
		const subscriptions = signalSubscriptions.count;
		for (let pass = 1; pass <= 3; pass += 1) {
			await act(async () => {
				root.render(render(pass));
			});
		}
		expect(seen.length).toBeGreaterThanOrEqual(4);
		expect(signalSubscriptions.count).toBe(subscriptions);
		expect(media.addCount()).toBe(adds);

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
