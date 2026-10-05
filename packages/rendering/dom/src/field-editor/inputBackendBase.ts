import type { Editor, InlineDecoration } from "@input/pen-types";
import type { InputBackend } from "../internal/inputBackend";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import {
	buildInlineDecorationsRenderSignature,
	inlineDecorationsForBlock,
	inlineDecorationsRequireFullReconcile,
} from "../utils/inlineDecorations";
import { BackendAttachment } from "./backendAttachment";
import { bindBackendTransferEvents } from "./backendTransferEvents";
import type {
	FieldEditorInputController,
	PenFieldEditorFocusOptions,
} from "./controller";
import type {
	FieldEditorDelta,
	FieldEditorObserver,
	FieldEditorTextChangeEvent,
	FieldEditorTextLike,
} from "./crdt";
import { renderFieldFromModel } from "./fieldDomRebuild";
import { applyDeltaToDOM } from "./reconciler";
import { bindSurfaceTabStop } from "./surfaceTabStop";

/**
 * FE1/CS5: what every input backend holds while attached — the element, the
 * attachment that undoes its bindings, the editor and the field editor — and
 * the contenteditable host and input-event bindings the contenteditable
 * backends share. A subclass keeps only its input technology.
 */
export abstract class InputBackendBase implements InputBackend {
	protected element: HTMLElement | null = null;
	protected readonly attachment = new BackendAttachment();
	protected editor: Editor;
	protected fieldEditor: FieldEditorInputController;

	protected abstract readonly handleBeforeInput: (event: InputEvent) => void;
	protected abstract readonly handleKeyDown: (event: KeyboardEvent) => void;
	protected abstract readonly handleCompositionStart: () => void;
	protected abstract readonly handleCompositionEnd: (
		event: CompositionEvent,
	) => void;

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	abstract activate(
		element: HTMLElement,
		ytext: unknown,
		focusOptions?: PenFieldEditorFocusOptions,
	): void;
	abstract deactivate(): void;
	abstract updateSelection(): void;

	/**
	 * P3: a rebuild of this field that no input of its own caused (undo,
	 * redo) projects the record through the projector, which withholds it
	 * under HOST9 and while editor chrome holds focus (S1). A host-built
	 * controller without the projector part writes it, as before the part
	 * existed.
	 */
	protected projectRebuiltField(): void {
		const blockId = this.fieldEditor.focusBlockId;
		if (blockId && this.fieldEditor.projectAfterRebuild) {
			this.fieldEditor.projectAfterRebuild([blockId]);
			return;
		}
		this.updateSelection();
	}

	/** Makes `element` the editing host, tabbable only while focused (AX1). */
	protected attachEditableHost(element: HTMLElement): void {
		this.element = element;
		element.contentEditable = "true";
		bindSurfaceTabStop(this.attachment, element);
	}

	/**
	 * Releases editability by removing the attribute, never
	 * `contentEditable = "false"`. When the surface expands, the blocks host
	 * becomes the editing host and this element stays inside it; an explicit
	 * `false` would leave a read-only island there. WebKit refuses to extend
	 * a selection out of such an island and clamps at its boundary, so a
	 * cross-block pointer drag that starts in this field could never reach
	 * the next block. Absent is equivalent while the parent is not editable,
	 * which is the single-field case.
	 */
	protected releaseEditableHost(): void {
		this.element?.removeAttribute("contenteditable");
		this.element?.removeAttribute("tabindex");
	}

	/** Input, composition and transfer events on the element (FE2). */
	protected bindInputEvents(element: HTMLElement): void {
		this.attachment.listen(element, "beforeinput", this.handleBeforeInput);
		this.attachment.listen(element, "keydown", this.handleKeyDown);
		this.attachment.listen(
			element,
			"compositionstart",
			this.handleCompositionStart,
		);
		this.attachment.listen(
			element,
			"compositionend",
			this.handleCompositionEnd,
		);
		bindBackendTransferEvents(
			this.attachment,
			element,
			this.editor,
			this.fieldEditor,
		);
	}

	/** Undoes every binding and forgets the element. */
	protected detach(): void {
		this.attachment.release();
		this.element = null;
	}
}

/**
 * The single-field backends (contenteditable and EditContext): one block's
 * `Y.Text`, its observer, and the field DOM rebuilt from the model with the
 * block's inline decorations (FE4).
 */
export abstract class FieldInputBackendBase extends InputBackendBase {
	protected ytext: FieldEditorTextLike | null = null;
	protected observer: FieldEditorObserver | null = null;
	protected inlineDecorationsSignature: readonly InlineDecoration[] | null =
		null;

	protected abstract readonly handleYTextChange: (
		event: FieldEditorTextChangeEvent,
	) => void;

	/** Whether an open composition owns the field's DOM. */
	protected abstract holdsComposition(): boolean;

	/** Observes `ytext` and the editor's decorations for the attached field. */
	protected observeField(ytext: FieldEditorTextLike): void {
		this.ytext = ytext;
		this.observer = (event) => this.handleYTextChange(event);
		this.attachment.observeText(ytext, this.observer);
		this.attachment.subscribe(
			this.editor.on("decorationsChange", this.handleDecorationsChange),
		);
		this.inlineDecorationsSignature = this.getInlineDecorationsSignature();
	}

	protected override detach(): void {
		super.detach();
		this.ytext = null;
		this.observer = null;
		this.inlineDecorationsSignature = null;
	}

	/** The focused block; a field whose block is gone deactivates instead. */
	protected liveFocusBlockId(): string | null {
		const blockId = this.fieldEditor.focusBlockId;
		if (blockId && this.editor.getBlock(blockId)) {
			return blockId;
		}
		this.fieldEditor.deactivate();
		return null;
	}

	/** The inline decorations of the focused field's block. */
	protected fieldDecorations(): readonly InlineDecoration[] {
		return inlineDecorationsForBlock(
			this.editor,
			this.fieldEditor.focusBlockId,
		);
	}

	/** Their render signature: the previous one itself while they render the same. */
	protected getInlineDecorationsSignature(): readonly InlineDecoration[] {
		return buildInlineDecorationsRenderSignature(
			this.fieldDecorations(),
			this.inlineDecorationsSignature,
		);
	}

	/** Mutation records the backend's own DOM writes produced; none by default. */
	protected discardObservedMutations(): void {}

	/** Renders the field from the model and reports the rebuild (FE4). */
	protected rebuildField(
		inlineDecorations = this.fieldDecorations(),
		blockId = this.fieldEditor.focusBlockId ?? undefined,
	): void {
		if (!this.element || !this.ytext) return;
		renderFieldFromModel(
			this.editor,
			this.ytext,
			this.element,
			inlineDecorations,
		);
		this.discardObservedMutations();
		this.fieldEditor.notifyDomReconciled(blockId);
	}

	/**
	 * Whether the decorations render differently from the field's last
	 * build. A change while a composition holds the field is deferred
	 * (`handleDecorationsChange`), so the composition's close checks this
	 * even when it changed no text.
	 */
	protected decorationsChangedSinceBuild(): boolean {
		return (
			this.getInlineDecorationsSignature() !== this.inlineDecorationsSignature
		);
	}

	/** Patches the field with `delta`; true when it fell back to a full rebuild. */
	protected reconcileDelta(
		blockId: string | null,
		delta: FieldEditorDelta[],
	): boolean {
		const inlineDecorations = this.fieldDecorations();
		const applied =
			!this.requiresFullReconcile(blockId, inlineDecorations) &&
			applyDeltaToDOM(
				delta,
				this.element!,
				this.editor.schema,
				urlPolicyFromEditor(this.editor),
			);
		if (!applied) {
			this.rebuildField(inlineDecorations, blockId ?? undefined);
		}
		return !applied;
	}

	/** Decorations that split text runs cannot take a delta patch. */
	protected requiresFullReconcile(
		_blockId: string | null,
		inlineDecorations: readonly InlineDecoration[],
	): boolean {
		return inlineDecorationsRequireFullReconcile(inlineDecorations);
	}

	/**
	 * Rebuilds the field when its decorations render differently. An open
	 * composition is rebuilt with them when it closes.
	 */
	protected handleDecorationsChange = (): void => {
		if (!this.element || !this.ytext || this.holdsComposition()) {
			return;
		}
		const next = this.getInlineDecorationsSignature();
		if (next === this.inlineDecorationsSignature) {
			return;
		}
		// a decoration can change while another control owns focus; writing
		// the selection back into this field would drag focus along with it
		// (a host-built controller has no projector part; it projects, as
		// before the part existed)
		const projectSelection =
			this.fieldEditor.projector?.shouldProjectSelectionAfterReconcile() ??
			true;
		this.inlineDecorationsSignature = next;
		this.rebuildField();
		if (projectSelection) {
			this.updateSelection();
		}
	};
}
