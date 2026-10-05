// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Pen } from "../primitives/index";
import { createTestEditor } from "./utils/toolbarTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

afterEach(async () => {
	while (cleanups.length > 0) {
		await act(async () => {
			cleanups.pop()?.();
		});
	}
});

async function renderButton(
	buttonProps: Record<string, unknown>,
	child: React.ReactElement,
): Promise<HTMLElement> {
	const editor = createTestEditor();
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	cleanups.push(() => {
		root.unmount();
		container.remove();
		editor.destroy();
	});
	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor },
				createElement(
					Pen.Toolbar.Root,
					null,
					createElement(
						Pen.Toolbar.Button,
						{ asChild: true, ...buttonProps },
						child,
					),
				),
			),
		);
	});
	return container.querySelector<HTMLElement>("[data-pen-toolbar-button]")!;
}

function press(target: HTMLElement): MouseEvent {
	const mousedown = new MouseEvent("mousedown", {
		bubbles: true,
		cancelable: true,
		button: 0,
	});
	target.dispatchEvent(mousedown);
	return mousedown;
}

describe("AX3: asChild composes the child's props with the primitive's", () => {
	it("AX3: a child onClick runs and onAction still fires", async () => {
		const seen: string[] = [];
		const button = await renderButton(
			{ onAction: () => seen.push("action") },
			createElement("button", { onClick: () => seen.push("child") }, "Bold"),
		);
		await act(async () => {
			button.click();
		});
		expect(seen).toEqual(["child", "action"]);
	});

	it("AX3: a child onMouseDown runs and the press guard still keeps focus", async () => {
		const seen: string[] = [];
		const button = await renderButton(
			{},
			createElement(
				"button",
				{ onMouseDown: () => seen.push("child") },
				"Bold",
			),
		);
		let event!: MouseEvent;
		await act(async () => {
			event = press(button);
		});
		expect(seen).toEqual(["child"]);
		expect(event.defaultPrevented).toBe(true);
	});

	it("AX3: a child that prevents the click default opts out of onAction", async () => {
		const seen: string[] = [];
		const button = await renderButton(
			{ onAction: () => seen.push("action") },
			createElement(
				"button",
				{
					onClick: (event: React.MouseEvent) => {
						event.preventDefault();
						seen.push("child");
					},
				},
				"Bold",
			),
		);
		await act(async () => {
			button.click();
		});
		expect(seen).toEqual(["child"]);
	});

	it("AX3: class names join and styles merge with the child's winning", async () => {
		const button = await renderButton(
			{ className: "pen", style: { color: "red", margin: 1 } },
			createElement(
				"button",
				{ className: "host", style: { color: "blue" } },
				"Bold",
			),
		);
		expect(button.className).toBe("pen host");
		expect(button.style.color).toBe("blue");
		expect(button.style.margin).toBe("1px");
	});
});
