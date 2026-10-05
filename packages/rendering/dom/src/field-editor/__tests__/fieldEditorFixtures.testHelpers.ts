import { createEditor, getCommandRegistry } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor, Extension } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { DIRECT_HANDLERS } from "../contenteditableDirectHandlers";
import type { FieldEditorInputController } from "../controller";
import type { FieldEditorTextLike } from "../crdt";
import type { EditContext } from "../editContextTypes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { stubFieldEditorParts } from "./fieldEditorParts.testHelpers";

type Range = { start: number; end: number };

/** The block's raw `Y.Text`, as a backend receives it on activate. */
export function getYText(editor: Editor, blockId: string): FieldEditorTextLike {
	const ydoc = editor.internals.adapter.raw<{
		getMap(name: string): {
			get(key: string): { get(field: string): unknown } | undefined;
		};
	}>(editor.internals.crdtDoc);
	const ytext = ydoc.getMap("blocks").get(blockId)?.get("content") as
		| FieldEditorTextLike
		| null
		| undefined;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

/**
 * An editor whose paragraphs hold `texts`: the first fills the initial block,
 * each further one is a new paragraph after it.
 */
export function seedParagraphs(
	texts: readonly string[],
	options: { extensions?: Extension[] } = {},
): { editor: Editor; blockIds: string[] } {
	const editor = createEditor({
		schema: defaultSchema,
		extensions: options.extensions,
	});
	const blockIds = [editor.firstBlock()!.id];
	for (let index = 1; index < texts.length; index++) {
		blockIds.push(crypto.randomUUID());
	}
	editor.apply(
		texts.flatMap((text, index) => [
			...(index === 0
				? []
				: [
						{
							type: "insert-block" as const,
							blockId: blockIds[index]!,
							blockType: "paragraph",
							props: {},
							position: { after: blockIds[index - 1]! },
						},
					]),
			...(text.length > 0
				? [
						{
							type: "splice-text" as const,
							blockId: blockIds[index]!,
							from: 0,
							to: 0,
							insert: text,
						},
					]
				: []),
		]),
	);
	return { editor, blockIds };
}

/** A plain-object keydown whose `preventDefault` flips `defaultPrevented`. */
export function keyEvent(
	key: string,
	options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		isComposing: false,
		defaultPrevented: false,
		preventDefault() {
			Object.defineProperty(this, "defaultPrevented", {
				configurable: true,
				value: true,
			});
		},
		...options,
	} as KeyboardEvent;
}

/** Records the name of every command the editor's registry dispatches. */
export function spyDispatch(editor: Editor): string[] {
	const registry = getCommandRegistry(editor);
	if (!registry) {
		throw new Error("expected command registry");
	}
	const dispatched: string[] = [];
	const originalDispatch = registry.dispatch.bind(registry);
	registry.dispatch = ((command, param, context) => {
		dispatched.push(command.name);
		return originalDispatch(command, param, context);
	}) as typeof registry.dispatch;
	return dispatched;
}

/** Runs `run` with `navigator.platform` set, restoring it afterwards. */
export function withPlatform<T>(platform: string, run: () => T): T {
	const previous = navigator.platform;
	const set = (value: string) =>
		Object.defineProperty(navigator, "platform", {
			configurable: true,
			value,
		});
	set(platform);
	try {
		return run();
	} finally {
		set(previous);
	}
}

export type Activation = {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
	kind: "activate" | "commit";
};

/**
 * A stub controller that records text activations. `commit: false` drops
 * `commitProgrammaticTextSelection`, which callers feature-detect, so the
 * activation falls back to `activateTextSelection`.
 */
export function recordingController(
	blockId: string,
	options: { commit?: boolean } = {},
) {
	const activations: Activation[] = [];
	let deactivated = 0;
	const record =
		(kind: Activation["kind"]) =>
		(targetBlockId: string, anchorOffset: number, focusOffset: number) => {
			activations.push({
				blockId: targetBlockId,
				anchorOffset,
				focusOffset,
				kind,
			});
		};
	const controller = {
		focusBlockId: blockId,
		inputMode: "richtext" as const,
		activeCellCoord: null,
		selection: null,
		selectAllBehavior: "block-first" as const,
		activateCell: () => {},
		activateTextSelection: record("activate"),
		...(options.commit === false
			? {}
			: { commitProgrammaticTextSelection: record("commit") }),
		deactivate: () => {
			deactivated += 1;
		},
		requestDomFocus: () => false,
		applyDomTextSelection: () => {},
		applyDocumentTextSelection: () => {},
		syncTextSelection: () => {},
		setComposing: () => {},
		notifyDomReconciled: () => {},
		...stubFieldEditorParts(),
	} as unknown as FieldEditorInputController;
	return { controller, activations, deactivated: () => deactivated };
}

/** Runs one contenteditable `beforeinput` handler with a stubbed backend. */
export function runDirectHandler(
	inputType: string,
	options: {
		editor: Editor;
		blockId: string;
		controller: FieldEditorInputController;
		range: Range | (() => Range);
		data?: string;
		applyInlineTextEdit?: () => void;
	},
): void {
	const { editor, blockId, controller, range } = options;
	DIRECT_HANDLERS[inputType]!(
		{ inputType, data: options.data ?? null } as InputEvent,
		editor,
		getYText(editor, blockId),
		controller,
		{} as HTMLElement,
		{
			resolveCurrentInputRange: () =>
				typeof range === "function" ? range() : range,
			applyListInputRule: () => false,
			applyInlineTextEdit: options.applyInlineTextEdit ?? (() => {}),
		},
	);
}

/** An `EditContext` that keeps its buffer and lets a test fire its events. */
export class FakeEditContext implements EditContext {
	text: string;
	selectionStart = 0;
	selectionEnd = 0;
	readonly updateTextCalls: Array<[number, number, string]> = [];
	private readonly listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(options?: { text?: string }) {
		this.text = options?.text ?? "";
	}

	updateText(start: number, end: number, text: string): void {
		this.updateTextCalls.push([start, end, text]);
		this.text = `${this.text.slice(0, start)}${text}${this.text.slice(end)}`;
	}

	updateSelection(start: number, end: number): void {
		this.selectionStart = start;
		this.selectionEnd = end;
	}

	updateCharacterBounds(): void {}

	addEventListener(type: string, handler: (event: Event) => void): void {
		const handlers = this.listeners.get(type) ?? new Set();
		handlers.add(handler);
		this.listeners.set(type, handlers);
	}

	removeEventListener(type: string, handler: (event: Event) => void): void {
		this.listeners.get(type)?.delete(handler);
	}

	get listenerCount(): number {
		let total = 0;
		for (const handlers of this.listeners.values()) total += handlers.size;
		return total;
	}

	/** Fires `event`, or a bare `Event` of `type` carrying `init`'s fields. */
	emit(type: string, init: Event | Record<string, unknown> = {}): void {
		const event =
			init instanceof Event ? init : Object.assign(new Event(type), init);
		for (const handler of this.listeners.get(type) ?? []) handler(event);
	}

	textUpdate(
		updateRangeStart: number,
		updateRangeEnd: number,
		text: string,
	): void {
		const caret = updateRangeStart + text.length;
		this.emit("textupdate", {
			text,
			updateRangeStart,
			updateRangeEnd,
			selectionStart: caret,
			selectionEnd: caret,
		});
	}

	textFormatUpdate(): void {
		this.emit("textformatupdate", { getTextFormats: () => [] });
	}
}

export function installFakeEditContext(): void {
	(globalThis as { EditContext?: unknown }).EditContext = FakeEditContext;
}

export function removeEditContext(): void {
	delete (globalThis as { EditContext?: unknown }).EditContext;
}

export function contextOf(element: HTMLElement): FakeEditContext {
	return (element as HTMLElement & { editContext: FakeEditContext })
		.editContext;
}

/** `root > block > inline` for one block, appended to the document. */
export function mountBlockDom(
	blockId: string,
	text = "",
): { root: HTMLElement; inline: HTMLElement } {
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = text;
	block.append(inline);
	root.append(block);
	document.body.append(root);
	return { root, inline };
}

const mountedFields: Array<() => void> = [];

/**
 * A `FieldEditorImpl` activated on one paragraph holding `text`, on the
 * EditContext backend (a `FakeEditContext`) or, by default, contenteditable.
 * Register `cleanupMountedFields` in `afterEach`.
 */
export function mountField(
	text: string,
	options: { editContext?: boolean; undo?: boolean; caret?: number } = {},
) {
	if (options.editContext) installFakeEditContext();
	else removeEditContext();
	const {
		editor,
		blockIds: [blockId],
	} = seedParagraphs([text], {
		extensions: options.undo ? [undoExtension()] : undefined,
	});
	if (options.undo) editor.undoManager.setGroupTimeout(0);
	const fieldEditor = new FieldEditorImpl(editor);
	const { root, inline } = mountBlockDom(blockId!, text);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockId!);
	if (options.caret != null) {
		editor.selectText(blockId!, options.caret, options.caret);
	}
	mountedFields.push(() => {
		fieldEditor.destroy();
		root.remove();
		editor.destroy();
	});
	return {
		editor,
		fieldEditor,
		root,
		inline,
		blockId: blockId!,
		/** The fake attached to the field; EditContext mode only. */
		editContext: contextOf(inline),
		text: () => editor.getBlock(blockId!)?.textContent() ?? "",
	};
}

export function cleanupMountedFields(): void {
	for (const cleanup of mountedFields.splice(0).reverse()) cleanup();
	removeEditContext();
}
