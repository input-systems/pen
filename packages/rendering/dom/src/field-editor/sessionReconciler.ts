import {
	affectedBlockIdsFromSummary,
	emptyDecorationSet,
	getOpOriginType,
} from "@input/pen-core";
import type {
	DecorationSet,
	Editor,
	InlineDecoration,
	OpOrigin,
} from "@input/pen-types";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import type { DomScheduler } from "../scheduler";
import { fullReconcileToDOM } from "./reconciler";
import type { FieldEditorTextLike } from "./crdt";

interface SessionSnapshot {
	focusBlockId: string | null;
	activeBlockIds: readonly string[];
	isEditing: boolean;
	mode: "inactive" | "single" | "expanded" | "block";
}

interface SessionReconcilerOptions {
	getSnapshot: () => SessionSnapshot;
	getAttachedElement: () => HTMLElement | null;
	getInlineElement: (blockId: string) => HTMLElement | null;
	getYText: (blockId: string) => FieldEditorTextLike | null;
	shouldPreserveSelection: () => boolean;
	shouldProjectSelection: () => boolean;
	projectSelection: () => void;
	notifyDomReconciled?: (blockId: string) => void;
	getScheduler: () => DomScheduler | null;
}

export class SessionReconciler {
	private readonly editor: Editor;
	private readonly options: SessionReconcilerOptions;
	private readonly pendingBlockIds = new Set<string>();
	private seenDecorations: DecorationSet;
	private scheduledWrite = false;
	private destroyed = false;
	private shouldProjectSelection = false;
	private readonly unsubscribeCommit: () => void;
	private readonly unsubscribeDecorationsChange: () => void;

	constructor(editor: Editor, options: SessionReconcilerOptions) {
		this.editor = editor;
		this.options = options;
		this.seenDecorations = editor.getDecorations();
		this.unsubscribeCommit = this.editor.on("commit", (event) => {
			this.handleCommit(
				event.origin,
				affectedBlockIdsFromSummary(event.summary),
			);
		});
		this.unsubscribeDecorationsChange = this.editor.on(
			"decorationsChange",
			() => {
				this.handleDecorationsChange();
			},
		);
	}

	destroy(): void {
		this.destroyed = true;
		this.unsubscribeCommit();
		this.unsubscribeDecorationsChange();
		this.scheduledWrite = false;
		this.pendingBlockIds.clear();
		this.seenDecorations = emptyDecorationSet();
		this.shouldProjectSelection = false;
	}

	notifyFrameAvailable(): void {
		if (this.pendingBlockIds.size === 0) {
			return;
		}
		this.scheduleFlush();
	}

	private handleCommit(
		origin: OpOrigin,
		affectedBlocks: readonly string[],
	): void {
		const snapshot = this.options.getSnapshot();
		if (!snapshot.isEditing) {
			return;
		}

		if (snapshot.mode === "expanded") {
			const activeBlockIdSet = new Set(snapshot.activeBlockIds);
			const targetBlockIds = affectedBlocks.filter((blockId) =>
				activeBlockIdSet.has(blockId),
			);
			if (targetBlockIds.length === 0) {
				return;
			}
			for (const blockId of targetBlockIds) {
				this.pendingBlockIds.add(blockId);
			}
			this.shouldProjectSelection = true;
			this.scheduleFlush();
			return;
		}

		if (snapshot.mode !== "single" || !snapshot.focusBlockId) {
			return;
		}

		const focusBlockId = snapshot.focusBlockId;
		const focusBlockChanged = affectedBlocks.includes(focusBlockId);
		const passiveBlockIds = affectedBlocks.filter(
			(blockId) => blockId !== focusBlockId,
		);
		const shouldReconcileFocusBlock =
			focusBlockChanged && getOpOriginType(origin) === "history";

		if (!shouldReconcileFocusBlock && passiveBlockIds.length === 0) {
			return;
		}

		if (shouldReconcileFocusBlock) {
			this.pendingBlockIds.add(focusBlockId);
			this.shouldProjectSelection = true;
		}
		for (const blockId of passiveBlockIds) {
			this.pendingBlockIds.add(blockId);
		}
		this.scheduleFlush();
	}

	private handleDecorationsChange(): void {
		// core keeps a block's list by identity while it is structurally
		// unchanged (SCALE2), so a change elsewhere in the document does not
		// rebuild the editing surface — nor bump domSyncVersion, which
		// re-renders every block subscriber
		const previous = this.seenDecorations;
		const next = this.editor.getDecorations();
		this.seenDecorations = next;
		const hasBlockChanged = (blockId: string): boolean =>
			previous.forBlock(blockId) !== next.forBlock(blockId);

		const snapshot = this.options.getSnapshot();
		if (!snapshot.isEditing) {
			return;
		}
		if (snapshot.mode === "expanded") {
			const changedBlockIds = snapshot.activeBlockIds.filter(hasBlockChanged);
			for (const blockId of changedBlockIds) {
				this.pendingBlockIds.add(blockId);
			}
			if (changedBlockIds.length > 0) {
				// a cross-block range cannot be preserved per element; rebuild
				// the blocks and project it back from the editor
				this.shouldProjectSelection = true;
				this.scheduleFlush();
			}
			return;
		}
		if (
			snapshot.mode === "single" &&
			snapshot.focusBlockId &&
			hasBlockChanged(snapshot.focusBlockId)
		) {
			this.pendingBlockIds.add(snapshot.focusBlockId);
			this.scheduleFlush();
		}
	}

	private scheduleFlush(): void {
		if (this.destroyed || this.scheduledWrite) {
			return;
		}
		const scheduler = this.options.getScheduler();
		if (!scheduler) {
			return;
		}
		this.scheduledWrite = true;
		void scheduler.write(() => {
			this.scheduledWrite = false;
			if (this.destroyed) {
				return;
			}
			this.flush();
		});
	}

	private flush(): void {
		if (this.pendingBlockIds.size === 0) {
			this.shouldProjectSelection = false;
			return;
		}

		const snapshot = this.options.getSnapshot();
		const blockIds = [...this.pendingBlockIds];
		this.pendingBlockIds.clear();
		const shouldProjectSelection = this.shouldProjectSelection;
		this.shouldProjectSelection = false;

		if (!snapshot.isEditing) {
			return;
		}

		const preserveSelection = this.options.shouldPreserveSelection();

		if (snapshot.mode === "expanded") {
			const activeBlockIdSet = new Set(snapshot.activeBlockIds);
			for (const blockId of blockIds) {
				if (!activeBlockIdSet.has(blockId)) {
					continue;
				}
				this.reconcileBlock(blockId, preserveSelection);
			}
			if (
				shouldProjectSelection &&
				this.options.shouldProjectSelection()
			) {
				this.options.projectSelection();
			}
			return;
		}

		if (snapshot.mode !== "single" || !snapshot.focusBlockId) {
			return;
		}

		for (const blockId of blockIds) {
			if (blockId === snapshot.focusBlockId) {
				const element =
					this.options.getAttachedElement() ??
					this.options.getInlineElement(snapshot.focusBlockId);
				const ytext = this.options.getYText(snapshot.focusBlockId);
				if (!element || !ytext) {
					continue;
				}
				fullReconcileToDOM(ytext, element, this.editor.schema, {
					preserveSelection,
					inlineDecorations: this.getInlineDecorations(blockId),
					urlPolicy: urlPolicyFromEditor(this.editor),
				});
				this.options.notifyDomReconciled?.(blockId);
				continue;
			}
			this.reconcileBlock(blockId, preserveSelection);
		}
		if (shouldProjectSelection && this.options.shouldProjectSelection()) {
			this.options.projectSelection();
		}
	}

	private reconcileBlock(blockId: string, preserveSelection = true): void {
		const inlineElement = this.options.getInlineElement(blockId);
		const ytext = this.options.getYText(blockId);
		if (!inlineElement || !ytext) {
			return;
		}
		fullReconcileToDOM(ytext, inlineElement, this.editor.schema, {
			preserveSelection,
			inlineDecorations: this.getInlineDecorations(blockId),
			urlPolicy: urlPolicyFromEditor(this.editor),
		});
		this.options.notifyDomReconciled?.(blockId);
	}

	private getInlineDecorations(blockId: string): readonly InlineDecoration[] {
		return this.editor
			.getDecorations()
			.forBlock(blockId)
			.filter(
				(decoration): decoration is InlineDecoration =>
					decoration.type === "inline",
			);
	}
}
