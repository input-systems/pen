import type { Editor } from "@input/pen-types";
import type {
	FieldEditorInputController,
	PenFieldEditorFocusOptions,
} from "./controller";
import type { FieldEditorTextLike } from "./crdt";
import type { InputBackend } from "../internal/inputBackend";

export type InputBackendConstructor = new (
	editor: Editor,
	fieldEditor: FieldEditorInputController,
) => InputBackend;

export class BackendLifecycleController {
	private readonly editor: Editor;
	private readonly fieldEditor: FieldEditorInputController;
	private backend: InputBackend | null = null;

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	get current(): InputBackend | null {
		return this.backend;
	}

	hasBackend(BackendClass: InputBackendConstructor): boolean {
		return this.backend?.constructor === BackendClass;
	}

	replace(BackendClass: InputBackendConstructor): void {
		this.deactivate();
		this.backend = new BackendClass(this.editor, this.fieldEditor);
	}

	activate(
		element: HTMLElement,
		ytext: FieldEditorTextLike,
		focusOptions?: PenFieldEditorFocusOptions,
	): void {
		this.backend?.activate(element, ytext, focusOptions);
	}

	updateSelection(): void {
		this.backend?.updateSelection();
	}

	deactivate(): void {
		this.backend?.deactivate();
		this.backend = null;
	}
}
