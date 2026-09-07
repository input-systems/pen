// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import {
	useSuggestionMenu,
	type SuggestionMenuController,
} from "../hooks/useSuggestionMenu";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function waitForCondition(
	check: () => boolean,
	maxTicks = 20,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (check()) {
			return;
		}
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

function createSuggestionMenuEditor() {
	return createEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

function dispatchKey(key: string, target: EventTarget = document) {
	target.dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
		}),
	);
}

function createRect(
	left: number,
	top: number,
	width: number,
	height: number,
): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
		toJSON() {
			return {};
		},
	} as DOMRect;
}

function requireMenu<TItem>(
	menu: SuggestionMenuController<TItem> | null,
): SuggestionMenuController<TItem> {
	if (!menu) {
		throw new Error("Suggestion menu did not initialize");
	}
	return menu;
}

describe("@input/pen-react suggestion menu: trigger and anchoring", () => {
	it("opens from a typed trigger and confirms the selected item", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const selectedItems: string[] = [];

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: {
					char: "@",
					boundary: "whitespace",
					minQueryLength: 1,
				},
				getItems({ query }) {
					return ["Alex", "Alice"].filter((item) =>
						item.toLowerCase().startsWith(query.toLowerCase()),
					);
				},
				onSelect({ item, target }) {
					selectedItems.push(item);
					editor.apply([
						{
							type: "splice-text",
							blockId: target.blockId,
							from: target.startOffset,
							to:
								target.startOffset +
								target.endOffset -
								target.startOffset,
							insert: "",
						},
						{
							type: "splice-text",
							blockId: target.blockId,
							from: target.startOffset,
							to: target.startOffset,
							insert: item,
						},
					]);
				},
			});
			const menuItems = menu.items.map((item, index) => (
				<Pen.SuggestionMenu.Item key={item} index={index}>
					{item}
				</Pen.SuggestionMenu.Item>
			));

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
					<Pen.SuggestionMenu.Root controller={menu}>
						<Pen.SuggestionMenu.Content>
							<Pen.SuggestionMenu.List>
								{menuItems}
							</Pen.SuggestionMenu.List>
						</Pen.SuggestionMenu.Content>
					</Pen.SuggestionMenu.Root>
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
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hi @al",
				},
			]);
			editor.selectText(blockId, 6, 6);
			await waitForCondition(
				() =>
					container.querySelector(
						"[data-pen-suggestion-menu-content]",
					) !== null,
			);
		});

		expect(
			container.querySelector("[data-pen-suggestion-menu-content]"),
		).not.toBeNull();
		const suggestionContent = container.querySelector<HTMLElement>(
			"[data-pen-suggestion-menu-content]",
		);
		expect(suggestionContent?.style.transform).toBe("");

		const downstreamKeyDown = vi.fn();
		container.addEventListener("keydown", downstreamKeyDown);
		await act(async () => {
			dispatchKey("ArrowDown", container);
			dispatchKey("Enter", container);
		});

		expect(downstreamKeyDown).not.toHaveBeenCalled();
		expect(selectedItems).toEqual(["Alice"]);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hi Alice");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps controlled state open when selection vetoes dismissal", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const onOpenChange = vi.fn();
		const onSelect = vi.fn(() => false);
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
					<Pen.SuggestionMenu.Root
						controller={menu}
						open={menu.open}
						onOpenChange={onOpenChange}
					/>
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
			dispatchKey("Enter", container);
		});

		expect(onSelect).toHaveBeenCalledOnce();
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(requireMenu(menuSnapshot).open).toBe(true);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("dismisses an open menu when disabled", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		let setEnabled:
			| React.Dispatch<React.SetStateAction<boolean>>
			| undefined;
		let menuSnapshot: SuggestionMenuController<string> | null = null;

		function Harness() {
			const [enabled, setEnabledState] = React.useState(true);
			setEnabled = setEnabledState;
			const menu = useSuggestionMenu<string>({
				editor,
				enabled,
				trigger: {
					char: "@",
					boundary: "whitespace",
					minQueryLength: 1,
				},
				getItems: () => ["Alex"],
				onSelect: vi.fn(),
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

		expect(requireMenu(menuSnapshot).open).toBe(true);

		await act(async () => {
			setEnabled?.(false);
			await waitForCondition(() => !requireMenu(menuSnapshot).open);
		});

		expect(requireMenu(menuSnapshot).open).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("anchors content to the trigger start instead of the caret", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const originalGetBoundingClientRect =
			HTMLElement.prototype.getBoundingClientRect;
		HTMLElement.prototype.getBoundingClientRect = function () {
			if (this.hasAttribute("data-pen-inline-content")) {
				return createRect(144, 40, 220, 20);
			}
			if (this.hasAttribute("data-pen-suggestion-menu-content")) {
				return createRect(0, 0, 200, 100);
			}
			return originalGetBoundingClientRect.call(this);
		};

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: {
					char: "@",
					boundary: "whitespace",
					minQueryLength: 1,
				},
				getItems: () => ["Alex"],
				onSelect: vi.fn(),
			});

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
					<Pen.SuggestionMenu.Root controller={menu}>
						<Pen.SuggestionMenu.Content>
							<Pen.SuggestionMenu.List>
								<Pen.SuggestionMenu.Item index={0}>
									Alex
								</Pen.SuggestionMenu.Item>
							</Pen.SuggestionMenu.List>
						</Pen.SuggestionMenu.Content>
					</Pen.SuggestionMenu.Root>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				editor.apply([
					{
						type: "splice-text",
						blockId,
						from: 0,
						to: 0,
						insert: "Hi @al",
					},
				]);
				editor.selectText(blockId, 6, 6);
				root.render(<Harness />);
				await waitForCondition(
					() =>
						container.querySelector(
							"[data-pen-suggestion-menu-content]",
						) !== null,
				);
			});

			const suggestionContent = container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-content]",
			);
			expect(suggestionContent?.style.left).toBe("144px");
			expect(suggestionContent?.style.top).toBe("70px");
		} finally {
			HTMLElement.prototype.getBoundingClientRect =
				originalGetBoundingClientRect;
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("keeps top-placed content anchored when its height changes", async () => {
		const editor = createSuggestionMenuEditor();
		const blockId = editor.firstBlock()!.id;
		const originalGetBoundingClientRect =
			HTMLElement.prototype.getBoundingClientRect;
		let menuHeight = 200;
		let notifyResize: (() => void) | undefined;

		class TestResizeObserver {
			constructor(callback: ResizeObserverCallback) {
				notifyResize = () => callback([], this);
			}

			observe() {}
			unobserve() {}
			disconnect() {}
		}

		vi.stubGlobal("ResizeObserver", TestResizeObserver);
		HTMLElement.prototype.getBoundingClientRect = function () {
			if (this.hasAttribute("data-pen-inline-content")) {
				return createRect(144, 700, 220, 20);
			}
			if (this.hasAttribute("data-pen-suggestion-menu-content")) {
				return createRect(0, 0, 200, menuHeight);
			}
			return originalGetBoundingClientRect.call(this);
		};

		function Harness() {
			const menu = useSuggestionMenu<string>({
				editor,
				trigger: {
					char: "@",
					boundary: "whitespace",
					minQueryLength: 1,
				},
				getItems: () => ["Alex"],
				onSelect: vi.fn(),
			});

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
					<Pen.SuggestionMenu.Root controller={menu}>
						<Pen.SuggestionMenu.Content>
							<Pen.SuggestionMenu.List>
								<Pen.SuggestionMenu.Item index={0}>
									Alex
								</Pen.SuggestionMenu.Item>
							</Pen.SuggestionMenu.List>
						</Pen.SuggestionMenu.Content>
					</Pen.SuggestionMenu.Root>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				editor.apply([
					{
						type: "splice-text",
						blockId,
						from: 0,
						to: 0,
						insert: "Hi @al",
					},
				]);
				editor.selectText(blockId, 6, 6);
				root.render(<Harness />);
				await waitForCondition(
					() =>
						container.querySelector(
							"[data-pen-suggestion-menu-content]",
						) !== null,
				);
			});

			const suggestionContent = container.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-content]",
			);
			expect(suggestionContent?.style.top).toBe("490px");

			menuHeight = 100;
			await act(async () => {
				notifyResize?.();
			});

			expect(suggestionContent?.style.top).toBe("590px");
		} finally {
			vi.unstubAllGlobals();
			HTMLElement.prototype.getBoundingClientRect =
				originalGetBoundingClientRect;
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
