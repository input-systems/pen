// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import {
	aiSuggestionsExtension,
	getAISuggestionsController,
} from "@input/pen-ai/suggestions";
import { Pen } from "../primitives/index";
import { defaultSchema } from "@input/pen-schema";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function flush(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await Promise.resolve();
}

async function waitForCondition(
	check: () => boolean,
	maxTicks = 20,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (check()) {
			return;
		}
		await flush();
	}
}

function dispatchKey(key: string, target: EventTarget = document): void {
	target.dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
		}),
	);
}

async function openSuggestionsPopover() {
	const editor = createEditor({
		schema: defaultSchema,
		extensions: [
			aiSuggestionsExtension({
				debounceMs: 0,
				minStableMs: 0,
				minChangedChars: 1,
				analyzer: {
					async analyze() {
						return {
							candidates: [
								{
									kind: "spelling",
									title: "Spelling",
									originalText: "Ths",
									replacementText: "This",
									reason: "Fix the misspelling.",
									confidence: 0.99,
								},
							],
						};
					},
				},
			}),
		],
	});
	const blockId = editor.firstBlock()!.id;
	editor.apply(
		[
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Ths sentence works.",
			},
		],
		{ origin: "user" },
	);

	await waitForCondition(
		() =>
			(getAISuggestionsController(editor)?.getState().suggestions
				.length ?? 0) > 0,
	);

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor },
				createElement(
					"div",
					{
						"data-pen-field-editor-active-surface": "",
						tabIndex: 0,
					},
					"field",
				),
				createElement(
					Pen.AISuggestions.Root,
					{ editor },
					createElement(Pen.AISuggestions.Popover),
				),
			),
		);
		await flush();
	});

	const suggestion =
		getAISuggestionsController(editor)?.getState().suggestions[0] ?? null;
	if (!suggestion) {
		throw new Error("expected an AI suggestion");
	}

	const anchor = document.createElement("button");
	anchor.setAttribute("data-ai-suggestion-id", suggestion.id);
	anchor.getBoundingClientRect = () =>
		({
			top: 100,
			left: 160,
			width: 48,
			height: 20,
			right: 208,
			bottom: 120,
			x: 160,
			y: 100,
			toJSON() {
				return this;
			},
		}) as DOMRect;
	const aiRoot = container.querySelector(
		"[data-pen-ai-suggestions-root]",
	) as HTMLElement | null;
	aiRoot?.appendChild(anchor);

	await act(async () => {
		anchor.dispatchEvent(
			new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
			}),
		);
		await flush();
	});

	const fixture = { blockId, container, editor, root };
	fixtures.push(fixture);
	return fixture;
}

/** Mounts a second editor before the one under test, so `document.querySelector` finds it first. */
async function mountBystanderEditor() {
	const editor = createEditor({ schema: defaultSchema });
	const container = document.createElement("div");
	document.body.prepend(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				Pen.Editor.Root,
				{ editor },
				createElement(
					"div",
					{ "data-pen-field-editor-active-surface": "", tabIndex: 0 },
					"bystander",
				),
			),
		);
		await flush();
	});
	fixtures.push({ blockId: editor.firstBlock()!.id, container, editor, root });
	return { container, editor };
}

const fixtures: Array<{
	blockId: string;
	container: HTMLElement;
	editor: ReturnType<typeof createEditor>;
	root: ReturnType<typeof createRoot>;
}> = [];

afterEach(async () => {
	while (fixtures.length > 0) {
		const fixture = fixtures.pop();
		if (!fixture) {
			break;
		}
		await act(async () => {
			fixture.root.unmount();
		});
		fixture.container.remove();
		fixture.editor.destroy();
	}
});

describe("@input/pen-react AI suggestions popover AX3", () => {
	it("AX3 exposes listbox option ids and field popup aria without moving focus", async () => {
		const fixture = await openSuggestionsPopover();

		const listbox = document.querySelector<HTMLElement>(
			"[data-pen-ai-suggestions-popover]",
		);
		const options = document.querySelectorAll<HTMLElement>(
			"[data-pen-ai-suggestions-option]",
		);
		const field = fixture.container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);
		const selectedOption = document.querySelector<HTMLElement>(
			"[data-pen-ai-suggestions-option][data-selected]",
		);

		expect(listbox?.getAttribute("role")).toBe("listbox");
		expect(listbox?.id).toBeTruthy();
		expect(options).toHaveLength(2);
		expect(options[0]?.getAttribute("role")).toBe("option");
		expect(options[1]?.getAttribute("role")).toBe("option");
		expect(options[0]?.id).toBe(`${listbox?.id}-option-0`);
		expect(options[1]?.id).toBe(`${listbox?.id}-option-1`);
		expect(selectedOption?.id).toBe(`${listbox?.id}-option-1`);
		expect(options[1]?.getAttribute("aria-selected")).toBe("true");

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
			document.activeElement?.closest(
				"[data-pen-ai-suggestions-popover]",
			),
		).toBeNull();
		expect(field?.getAttribute("aria-activedescendant")).toBe(
			options[0]?.id,
		);
		expect(options[0]?.getAttribute("aria-selected")).toBe("true");
	});

	it("AX3 Home End Arrow Enter Escape navigate the existing apply dismiss model", async () => {
		const fixture = await openSuggestionsPopover();
		const field = fixture.container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);
		const listbox = document.querySelector<HTMLElement>(
			"[data-pen-ai-suggestions-popover]",
		);
		const options = document.querySelectorAll<HTMLElement>(
			"[data-pen-ai-suggestions-option]",
		);

		await act(async () => {
			field?.focus();
			dispatchKey("Home");
		});
		expect(field?.getAttribute("aria-activedescendant")).toBe(
			options[0]?.id,
		);

		await act(async () => {
			dispatchKey("End");
		});
		expect(field?.getAttribute("aria-activedescendant")).toBe(
			options[1]?.id,
		);

		await act(async () => {
			dispatchKey("ArrowUp");
		});
		expect(field?.getAttribute("aria-activedescendant")).toBe(
			options[0]?.id,
		);

		await act(async () => {
			dispatchKey("Escape");
			await flush();
		});
		expect(
			document.querySelector("[data-pen-ai-suggestions-popover]"),
		).toBeNull();
		expect(field?.getAttribute("aria-controls")).toBeNull();
		expect(field?.getAttribute("aria-activedescendant")).toBeNull();
		expect(listbox?.id).toBeTruthy();

		const suggestion =
			getAISuggestionsController(fixture.editor)?.getState()
				.suggestions[0] ?? null;
		expect(suggestion).toBeTruthy();
		const anchor = document.createElement("button");
		anchor.setAttribute("data-ai-suggestion-id", suggestion!.id);
		anchor.getBoundingClientRect = () =>
			({
				top: 100,
				left: 160,
				width: 48,
				height: 20,
				right: 208,
				bottom: 120,
				x: 160,
				y: 100,
				toJSON() {
					return this;
				},
			}) as DOMRect;
		fixture.container
			.querySelector("[data-pen-ai-suggestions-root]")
			?.appendChild(anchor);

		await act(async () => {
			anchor.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
			await flush();
		});

		await act(async () => {
			dispatchKey("Enter");
			await flush();
		});

		expect(
			fixture.editor.getBlock(fixture.blockId)?.textContent({
				resolved: true,
			}),
		).toBe("This sentence works.");
		expect(
			document.querySelector("[data-pen-ai-suggestions-popover]"),
		).toBeNull();
	});

	it("AX3: the AI suggestions popover wires aria-controls on its own editor's field when two editors are mounted", async () => {
		const bystander = await mountBystanderEditor();
		const fixture = await openSuggestionsPopover();
		const field = fixture.container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);
		const otherField = bystander.container.querySelector<HTMLElement>(
			"[data-pen-field-editor-active-surface]",
		);

		expect(field?.getAttribute("aria-controls")).toBeTruthy();
		expect(otherField?.getAttribute("aria-controls")).toBeNull();
	});

	it("AX3: the AI suggestions popover restores focus to its own editor root when two editors are mounted", async () => {
		const bystander = await mountBystanderEditor();
		const fixture = await openSuggestionsPopover();
		const ownRoot = fixture.container.querySelector<HTMLElement>(
			"[data-pen-editor-root]",
		);
		const otherRoot = bystander.container.querySelector<HTMLElement>(
			"[data-pen-editor-root]",
		);

		await act(async () => {
			dispatchKey("Escape");
			await flush();
		});

		expect(document.activeElement).not.toBe(otherRoot);
		expect(
			document.activeElement === ownRoot ||
				ownRoot?.contains(document.activeElement),
		).toBe(true);
	});
});
