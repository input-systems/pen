// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { fieldEditorHostFacet } from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { Pen } from "../primitives/index";
import {
	createSlashMenuEditor,
	dispatchKey,
} from "./utils/slashMenuTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createOpenController() {
	return {
		confirm: vi.fn(() => true),
		dismiss: vi.fn(),
		items: [
			{ type: "paragraph", display: { title: "Paragraph" } },
			{ type: "heading", display: { title: "Heading" } },
			{ type: "quote", display: { title: "Quote" } },
		],
		open: true,
		query: "",
		select: vi.fn(),
		selectedIndex: 1,
		setQuery: vi.fn(),
	};
}

describe("@input/pen-react slash menu AX3", () => {
	it("AX3 exposes listbox option ids and field popup aria without moving focus", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);
		const controller = createOpenController();

		function Harness() {
			return (
				<Pen.Editor.Root editor={editor}>
					<div data-pen-field-editor-active-surface="" tabIndex={0}>
						field
					</div>
					<Pen.SlashMenu.Root controller={controller} editor={editor}>
						<Pen.SlashMenu.List>
							<Pen.SlashMenu.Item index={0}>
								Paragraph
							</Pen.SlashMenu.Item>
							<Pen.SlashMenu.Item index={1}>
								Heading
							</Pen.SlashMenu.Item>
							<Pen.SlashMenu.Item index={2}>
								Quote
							</Pen.SlashMenu.Item>
						</Pen.SlashMenu.List>
					</Pen.SlashMenu.Root>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		const listbox = container.querySelector<HTMLElement>(
			"[data-pen-slash-menu-list]",
		);
		const options = container.querySelectorAll<HTMLElement>(
			"[data-pen-slash-menu-item]",
		);
		const field = container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);

		expect(listbox?.getAttribute("role")).toBe("listbox");
		expect(listbox?.getAttribute("aria-label")).toBe("Slash menu");
		expect(listbox?.hasAttribute("hidden")).toBe(false);
		expect(listbox?.id).toBeTruthy();
		expect(options).toHaveLength(3);
		expect(options[0]?.getAttribute("role")).toBe("option");
		expect(options[1]?.getAttribute("role")).toBe("option");
		expect(options[1]?.id).toBe(`${listbox?.id}-option-1`);
		expect(options[1]?.getAttribute("aria-selected")).toBe("true");
		expect(listbox?.getAttribute("aria-activedescendant")).toBe(
			options[1]?.id,
		);

		expect(field).not.toBeNull();
		expect(field?.getAttribute("aria-controls")).toBe(listbox?.id);
		expect(field?.getAttribute("aria-expanded")).toBe("true");
		expect(field?.getAttribute("aria-activedescendant")).toBe(
			options[1]?.id,
		);

		await act(async () => {
			field?.focus();
		});
		expect(document.activeElement).toBe(field);

		await act(async () => {
			dispatchKey("ArrowDown", field ?? document);
		});

		expect(document.activeElement).toBe(field);
		expect(
			document.activeElement?.closest("[data-pen-slash-menu-item]"),
		).toBeNull();
		expect(
			document.activeElement?.closest("[data-pen-slash-menu-list]"),
		).toBeNull();
		expect(controller.select).toHaveBeenCalledWith(2);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("AX3 Home End Arrow Enter Tab Escape navigate the existing selectedIndex model", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);
		const controller = createOpenController();

		function Harness() {
			return (
				<Pen.Editor.Root editor={editor}>
					<div data-pen-field-editor-active-surface="" tabIndex={0}>
						field
					</div>
					<Pen.SlashMenu.Root controller={controller} editor={editor}>
						<Pen.SlashMenu.Input />
						<Pen.SlashMenu.List>
							<Pen.SlashMenu.Item index={0}>
								Paragraph
							</Pen.SlashMenu.Item>
							<Pen.SlashMenu.Item index={1}>
								Heading
							</Pen.SlashMenu.Item>
							<Pen.SlashMenu.Item index={2}>
								Quote
							</Pen.SlashMenu.Item>
						</Pen.SlashMenu.List>
					</Pen.SlashMenu.Root>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		const listbox = container.querySelector<HTMLElement>(
			"[data-pen-slash-menu-list]",
		);
		const input = container.querySelector<HTMLInputElement>(
			"[data-pen-slash-menu-input]",
		);
		const selectedOption = container.querySelector<HTMLElement>(
			"[data-pen-slash-menu-item][data-selected]",
		);

		expect(input?.getAttribute("role")).toBe("combobox");
		expect(input?.getAttribute("aria-controls")).toBe(listbox?.id);
		expect(input?.getAttribute("aria-expanded")).toBe("true");
		expect(input?.getAttribute("aria-activedescendant")).toBe(
			selectedOption?.id,
		);

		await act(async () => {
			dispatchKey("Home");
			dispatchKey("End");
			dispatchKey("ArrowUp");
			dispatchKey("Enter");
			dispatchKey("Tab");
			dispatchKey("Escape");
		});

		expect(controller.select).toHaveBeenCalledWith(0);
		expect(controller.select).toHaveBeenCalledWith(2);
		expect(controller.select).toHaveBeenCalledWith(1);
		expect(controller.confirm).toHaveBeenCalledWith(1);
		expect(controller.confirm).toHaveBeenCalledTimes(2);
		expect(controller.dismiss).toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("HOST7 Escape dismisses an open slash menu without collapsing to a block selection", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "/",
			},
		]);
		const controller = createOpenController();

		function Harness() {
			const [open, setOpen] = React.useState(true);
			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
					<Pen.SlashMenu.Root
						controller={{ ...controller, open }}
						editor={editor}
						open={open}
						onOpenChange={setOpen}
					>
						<Pen.SlashMenu.List>
							<Pen.SlashMenu.Item index={0}>
								Paragraph
							</Pen.SlashMenu.Item>
						</Pen.SlashMenu.List>
					</Pen.SlashMenu.Root>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		const fieldEditor = editor.facet(
			fieldEditorHostFacet,
		) as FieldEditorImpl | null;
		expect(fieldEditor).not.toBeNull();

		await act(async () => {
			fieldEditor!.activateTextSelection(blockId, 1, 1);
		});

		const inline = container.querySelector<HTMLElement>(
			"[data-pen-inline-content]",
		);
		expect(inline).not.toBeNull();
		await act(async () => {
			inline!.focus();
		});

		await act(async () => {
			dispatchKey("Escape", inline!);
		});

		expect(controller.dismiss).toHaveBeenCalled();
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId, offset: 1 },
		});
		expect(editor.getBlock(blockId)?.textContent()).toBe("/");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("AX3 Escape clears field popup aria after close", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);
		const controller = createOpenController();

		function Harness() {
			const [open, setOpen] = React.useState(true);
			return (
				<Pen.Editor.Root editor={editor}>
					<div data-pen-field-editor-active-surface="" tabIndex={0}>
						field
					</div>
					<Pen.SlashMenu.Root
						controller={{ ...controller, open }}
						editor={editor}
						open={open}
						onOpenChange={setOpen}
					>
						<Pen.SlashMenu.List>
							<Pen.SlashMenu.Item index={0}>
								Paragraph
							</Pen.SlashMenu.Item>
							<Pen.SlashMenu.Item index={1}>
								Heading
							</Pen.SlashMenu.Item>
						</Pen.SlashMenu.List>
					</Pen.SlashMenu.Root>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		const field = container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);
		expect(field?.getAttribute("aria-expanded")).toBe("true");
		expect(field?.getAttribute("aria-controls")).toBeTruthy();

		await act(async () => {
			dispatchKey("Escape");
		});

		expect(controller.dismiss).toHaveBeenCalled();
		expect(field?.getAttribute("aria-expanded")).toBeNull();
		expect(field?.getAttribute("aria-controls")).toBeNull();
		expect(field?.getAttribute("aria-activedescendant")).toBeNull();
		const list = container.querySelector<HTMLElement>(
			"[data-pen-slash-menu-list]",
		);
		expect(list?.hasAttribute("hidden")).toBe(true);
		expect(list?.getAttribute("role")).toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("AX3 option pointerdown does not steal field focus", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);
		const controller = createOpenController();

		function Harness() {
			return (
				<Pen.Editor.Root editor={editor}>
					<div data-pen-field-editor-active-surface="" tabIndex={0}>
						field
					</div>
					<Pen.SlashMenu.Root controller={controller} editor={editor}>
						<Pen.SlashMenu.List>
							<Pen.SlashMenu.Item index={0}>
								Paragraph
							</Pen.SlashMenu.Item>
							<Pen.SlashMenu.Item index={1}>
								Heading
							</Pen.SlashMenu.Item>
						</Pen.SlashMenu.List>
					</Pen.SlashMenu.Root>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		const field = container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);
		const option = container.querySelector<HTMLElement>(
			"[data-pen-slash-menu-item]",
		);

		await act(async () => {
			field?.focus();
		});
		expect(document.activeElement).toBe(field);

		await act(async () => {
			option?.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(document.activeElement).toBe(field);
		expect(
			document.activeElement?.closest("[data-pen-slash-menu-item]"),
		).toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
