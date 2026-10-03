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

	create(BackendClass: InputBackendConstructor): InputBackend {
		return new BackendClass(this.editor, this.fieldEditor);
	}

	replace(BackendClass: InputBackendConstructor): InputBackend {
		this.deactivate();
		this.backend = this.create(BackendClass);
		return this.backend;
	}

	ensure(BackendClass: InputBackendConstructor): InputBackend {
		if (this.backend?.constructor === BackendClass) {
			return this.backend;
		}
		return this.replace(BackendClass);
	}

	activate(
		element: HTMLElement,
		ytext: FieldEditorTextLike,
		focusOptions?: PenFieldEditorFocusOptions,
	): void {
		this.backend?.activate(element, ytext, focusOptions);
	}

	updateSelection(relPos: unknown): void {
		this.backend?.updateSelection(relPos);
	}

	deactivate(): void {
		this.backend?.deactivate();
		this.backend = null;
	}
}
