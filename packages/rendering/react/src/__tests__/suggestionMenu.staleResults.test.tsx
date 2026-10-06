// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
	useSuggestionMenu,
	type SuggestionMenuController,
} from "../hooks/useSuggestionMenu";
import { Pen } from "../primitives/index";
import {
	createSuggestionMenuEditor,
	requireMenu,
	waitForCondition,
} from "./utils/suggestionMenuTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react suggestion menu: stale results", () => {
	it("ignores stale async results after the query changes", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const requests: Array<{
			query: string;
			resolve: (items: readonly string[]) => void;
		}> = [];
		let menuSnapshot: SuggestionMenuController<string> | null = null;

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: {
					char: ":",
					boundary: "whitespace",
					closingChar: ":",
					minQueryLength: 1,
					queryPattern: /^[a-z]+$/,
				},
				getItems({ query }) {
					return new Promise<readonly string[]>((resolve) => {
						requests.push({ query, resolve });
					});
				},
				onSelect: vi.fn(),
			});
			menuSnapshot = menu;

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			editor.apply([
				{ type: "splice-text", blockId, from: 0, to: 0, insert: ":f" },
			]);
			editor.selectText(blockId, 2, 2);
		});

		await act(async () => {
			editor.apply([
				{ type: "splice-text", blockId, from: 2, to: 2, insert: "i" },
			]);
			editor.selectText(blockId, 3, 3);
		});

		await waitForCondition(() =>
			requests.some((request) => request.query === "fi"),
		);
		const staleRequest = requests.find((request) => request.query === "f");
		const freshRequest = [...requests]
			.reverse()
			.find((request) => request.query === "fi");
		expect(staleRequest).toBeDefined();
		expect(freshRequest).toBeDefined();

		await act(async () => {
			staleRequest?.resolve(["fire"]);
			await Promise.resolve();
		});

		expect(requireMenu(menuSnapshot).items).toEqual([]);

		await act(async () => {
			freshRequest?.resolve(["fire", "first-quarter-moon"]);
			await waitForCondition(
				() => requireMenu(menuSnapshot).items.length === 2,
			);
		});

		expect(requireMenu(menuSnapshot).query).toBe("fi");
		expect(requireMenu(menuSnapshot).items).toEqual([
			"fire",
			"first-quarter-moon",
		]);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("never renders an empty loading state when getItems is synchronous", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const renders: Array<{ status: string; items: readonly string[] }> = [];

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: { char: "@", boundary: "whitespace" },
				getItems: ({ query }) => [`${query}@example.com`],
				onSelect: vi.fn(),
			});
			if (menu.open) {
				renders.push({ status: menu.status, items: menu.items });
			}

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			editor.apply([
				{ type: "splice-text", blockId, from: 0, to: 0, insert: "@a" },
			]);
			editor.selectText(blockId, 2, 2);
		});

		await act(async () => {
			editor.apply([
				{ type: "splice-text", blockId, from: 2, to: 2, insert: "d" },
			]);
			editor.selectText(blockId, 3, 3);
		});

		expect(renders.at(-1)).toEqual({
			status: "ready",
			items: ["ad@example.com"],
		});
		expect(renders.filter((render) => render.items.length === 0)).toEqual(
			[],
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps the previous items while a refined async query is pending", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const requests: Array<{
			query: string;
			resolve: (items: readonly string[]) => void;
		}> = [];
		let menuSnapshot: SuggestionMenuController<string> | null = null;

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: { char: ":", boundary: "whitespace" },
				getItems({ query }) {
					return new Promise<readonly string[]>((resolve) => {
						requests.push({ query, resolve });
					});
				},
				onSelect: vi.fn(),
			});
			menuSnapshot = menu;

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			editor.apply([
				{ type: "splice-text", blockId, from: 0, to: 0, insert: ":f" },
			]);
			editor.selectText(blockId, 2, 2);
		});
		await act(async () => {
			[...requests]
				.reverse()
				.find((request) => request.query === "f")
				?.resolve(["fire"]);
			await waitForCondition(
				() => requireMenu(menuSnapshot).status === "ready",
			);
		});

		await act(async () => {
			editor.apply([
				{ type: "splice-text", blockId, from: 2, to: 2, insert: "i" },
			]);
			editor.selectText(blockId, 3, 3);
		});

		expect(requireMenu(menuSnapshot).status).toBe("loading");
		expect(requireMenu(menuSnapshot).query).toBe("fi");
		expect(requireMenu(menuSnapshot).items).toEqual(["fire"]);

		await act(async () => {
			[...requests]
				.reverse()
				.find((request) => request.query === "fi")
				?.resolve(["first-quarter-moon"]);
			await waitForCondition(
				() => requireMenu(menuSnapshot).status === "ready",
			);
		});

		expect(requireMenu(menuSnapshot).items).toEqual(["first-quarter-moon"]);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("reports a synchronous getItems throw as the error state", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const failure = new Error("lookup failed");
		let menuSnapshot: SuggestionMenuController<string> | null = null;

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: { char: "@", boundary: "whitespace" },
				getItems: () => {
					throw failure;
				},
				onSelect: vi.fn(),
			});
			menuSnapshot = menu;

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			editor.apply([
				{ type: "splice-text", blockId, from: 0, to: 0, insert: "@a" },
			]);
			editor.selectText(blockId, 2, 2);
		});

		expect(requireMenu(menuSnapshot)).toMatchObject({
			status: "error",
			items: [],
			error: failure,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("dismisses instead of selecting when the target range is stale", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const onSelect = vi.fn();
		let menuSnapshot: SuggestionMenuController<string> | null = null;

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: {
					char: "@",
					boundary: "whitespace",
					minQueryLength: 1,
				},
				getItems: () => ["Alex"],
				onSelect,
			});
			menuSnapshot = menu;

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
					<Pen.SuggestionMenu.Root controller={menu} />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			editor.apply([
				{ type: "splice-text", blockId, from: 0, to: 0, insert: "@a" },
			]);
			editor.selectText(blockId, 2, 2);
			await waitForCondition(
				() => requireMenu(menuSnapshot).items.length === 1,
			);
		});

		await act(async () => {
			editor.selectText(blockId, 0, 0);
		});

		expect(requireMenu(menuSnapshot).confirm()).toBe(false);
		expect(onSelect).not.toHaveBeenCalled();
		expect(requireMenu(menuSnapshot).open).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
