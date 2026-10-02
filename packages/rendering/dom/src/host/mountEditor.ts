import { ariaReadOnlyFacet, resolveEditorA11yLabel } from "@input/pen-core";
import {
	FIELD_EDITOR_SLOT_KEY,
	type Editor,
	type InteractionModel,
	type Unsubscribe,
} from "@input/pen-types";
import { resolveSelectAllBehavior } from "../constants/selectAll";
import type { PenFocusPolicy } from "../field-editor/controller";
import { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { registerVerticalCaretMeasure } from "../geometry/verticalCaretMeasure";
import { bindEditorDocumentKeyDown } from "../utils/documentShortcuts";
import { buildDataAttributes, DATA_ATTRS } from "../utils/dataAttributes";
import { computeDocumentEmpty } from "../utils/editorEmptyState";
import { createDocumentTree } from "./documentTree";
import { handleFieldEditorPointerActivate } from "./pointerActivation";
import { handleFieldEditorRootFocus } from "./rootFocus";
import { adoptEditorChrome } from "../styles/editorChrome";

export interface MountEditorOptions {
	readonly?: boolean;
	interactionModel?: InteractionModel;
	focusPolicy?: PenFocusPolicy;
	/**
	 * Adopt the editor chrome stylesheet into the root's document.
	 * Default `true` so `mountEditor()` is a usable field. Pass `false` for
	 * the unstyled HOST6 path.
	 */
	chrome?: boolean;
}

export interface MountedEditor {
	readonly fieldEditor: FieldEditorImpl;
	readonly root: HTMLElement;
	destroy(): void;
}

export function mountEditor(
	editor: Editor,
	root: HTMLElement,
	options: MountEditorOptions = {},
): MountedEditor {
	const readonly = options.readonly === true;
	const interactionModel = options.interactionModel ?? "content-first";
	const releaseChrome =
		options.chrome === false
			? undefined
			: adoptEditorChrome(root.ownerDocument);
	const fieldEditor = new FieldEditorImpl(editor, {
		selectAllBehavior: resolveSelectAllBehavior(interactionModel),
		focusPolicy: options.focusPolicy,
	});

	editor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
	applyEditorRootAttrs(root, editor, {
		readonly,
		focused: false,
	});

	const tree = createDocumentTree(editor, fieldEditor, root);
	fieldEditor.setRootElement(root);
	const unregisterVerticalCaret = registerVerticalCaretMeasure(editor, root);

	const unsubscribers: Unsubscribe[] = [];

	const handleFocusIn = (event: FocusEvent): void => {
		fieldEditor.setFocused(true);
		applyEditorRootAttrs(root, editor, {
			readonly,
			focused: true,
		});
		handleFieldEditorRootFocus({
			event,
			editor,
			fieldEditor,
			root,
			readonly,
		});
	};

	const handleFocusOut = (): void => {
		const activeElement = root.ownerDocument?.activeElement;
		const nextFocused =
			activeElement instanceof Node && root.contains(activeElement);
		fieldEditor.setFocused(nextFocused);
		applyEditorRootAttrs(root, editor, {
			readonly,
			focused: nextFocused,
		});
	};

	const handlePointerActivate = (event: MouseEvent): void => {
		handleFieldEditorPointerActivate({
			event,
			editor,
			fieldEditor,
			root,
			blocksHost: tree.blocksHost,
			readonly,
		});
	};

	root.addEventListener("focusin", handleFocusIn);
	root.addEventListener("focusout", handleFocusOut);
	root.addEventListener("mousedown", handlePointerActivate);

	unsubscribers.push(editor.on("commit", () => tree.sync()));
	unsubscribers.push(fieldEditor.subscribe(() => tree.sync()));
	unsubscribers.push(
		bindEditorDocumentKeyDown({
			editor,
			fieldEditor,
			root,
			getInteractionModel: () => interactionModel,
		}),
	);

	const destroy = (): void => {
		for (const unsubscribe of unsubscribers) {
			unsubscribe();
		}
		root.removeEventListener("focusin", handleFocusIn);
		root.removeEventListener("focusout", handleFocusOut);
		root.removeEventListener("mousedown", handlePointerActivate);
		unregisterVerticalCaret();
		editor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, undefined);
		fieldEditor.setRootElement(null);
		fieldEditor.destroy();
		tree.content.remove();
		clearEditorRootAttrs(root);
		releaseChrome?.();
	};

	return { fieldEditor, root, destroy };
}

function applyEditorRootAttrs(
	root: HTMLElement,
	editor: Editor,
	state: { readonly: boolean; focused: boolean },
): void {
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	root.setAttribute(DATA_ATTRS.viewId, editor.internals.viewId);
	root.setAttribute("role", "textbox");
	root.setAttribute("aria-multiline", "true");
	root.tabIndex = state.focused ? -1 : 0;

	const label = resolveEditorA11yLabel(editor);
	if (label["aria-label"]) {
		root.setAttribute("aria-label", label["aria-label"]);
		root.removeAttribute("aria-labelledby");
	} else if (label["aria-labelledby"]) {
		root.setAttribute("aria-labelledby", label["aria-labelledby"]);
		root.removeAttribute("aria-label");
	}

	setBooleanAttr(root, DATA_ATTRS.focused, state.focused);
	setBooleanAttr(root, DATA_ATTRS.readonly, state.readonly);
	setBooleanAttr(root, DATA_ATTRS.empty, computeDocumentEmpty(editor));

	const ariaReadonly = state.readonly || editor.facet(ariaReadOnlyFacet);
	if (ariaReadonly) {
		root.setAttribute("aria-readonly", "true");
	} else {
		root.removeAttribute("aria-readonly");
	}
}

function clearEditorRootAttrs(root: HTMLElement): void {
	root.removeAttribute(DATA_ATTRS.editorRoot);
	root.removeAttribute(DATA_ATTRS.viewId);
	root.removeAttribute(DATA_ATTRS.focused);
	root.removeAttribute(DATA_ATTRS.readonly);
	root.removeAttribute(DATA_ATTRS.empty);
	root.removeAttribute("role");
	root.removeAttribute("aria-multiline");
	root.removeAttribute("aria-label");
	root.removeAttribute("aria-labelledby");
	root.removeAttribute("aria-readonly");
	root.removeAttribute("tabindex");
}

function setBooleanAttr(
	element: HTMLElement,
	name: string,
	value: boolean,
): void {
	const next = buildDataAttributes({ [name]: value })[name];
	if (next === undefined) {
		element.removeAttribute(name);
	} else {
		element.setAttribute(name, next);
	}
}
