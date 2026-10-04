import {
	affectedBlockIdsFromSummary,
	emptyDecorationSet,
	getOpOriginType,
} from "@input/pen-core";
import type { DecorationSet, Editor, OpOrigin } from "@input/pen-types";
import type { DomScheduler } from "../scheduler";
import { inlineDecorationsForBlock } from "../utils/inlineDecorations";
import { renderFieldFromModel } from "./fieldDomRebuild";
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
	/** P3, after this flush's rebuilds. */
	projectAfterRebuild: (blockIds: readonly string[]) => void;
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
	private unsubscribeCommit: (() => void) | null = null;
	private unsubscribeDecorationsChange: (() => void) | null = null;

	constructor(editor: Editor, options: SessionReconcilerOptions) {
		this.editor = editor;
		this.options = options;
		this.seenDecorations = editor.getDecorations();
		this.connect();
	}

	/** (Re)subscribes after `destroy()`; a no-op while connected. */
	connect(): void {
		if (this.unsubscribeCommit) {
			return;
		}
		this.destroyed = false;
		this.seenDecorations = this.editor.getDecorations();
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
		this.unsubscribeCommit?.();
		this.unsubscribeCommit = null;
		this.unsubscribeDecorationsChange?.();
		this.unsubscribeDecorationsChange = null;
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
			const changedBlockIds =
				snapshot.activeBlockIds.filter(hasBlockChanged);
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

		const rebuilt: string[] = [];
		if (snapshot.mode === "expanded") {
			const activeBlockIdSet = new Set(snapshot.activeBlockIds);
			for (const blockId of blockIds) {
				if (!activeBlockIdSet.has(blockId)) {
					continue;
				}
				this.reconcileBlock(blockId);
				rebuilt.push(blockId);
			}
			this.projectAfterFlush(shouldProjectSelection, rebuilt);
			return;
		}

		if (snapshot.mode !== "single" || !snapshot.focusBlockId) {
			return;
		}

		for (const blockId of blockIds) {
			if (blockId === snapshot.focusBlockId) {
				// The focused field is rebuilt only where it is mounted.
				const element =
					this.options.getAttachedElement() ??
					this.options.getInlineElement(blockId);
				if (this.reconcileBlock(blockId, element)) {
					rebuilt.push(blockId);
				}
				continue;
			}
			this.reconcileBlock(blockId);
			rebuilt.push(blockId);
		}
		this.projectAfterFlush(shouldProjectSelection, rebuilt);
	}

	/** A requested projection covers the rebuilt target; otherwise P3 decides. */
	private projectAfterFlush(
		shouldProjectSelection: boolean,
		rebuilt: readonly string[],
	): void {
		if (shouldProjectSelection && this.options.shouldProjectSelection()) {
			this.options.projectSelection();
			return;
		}
		if (rebuilt.length > 0) {
			this.options.projectAfterRebuild(rebuilt);
		}
	}

	/** Rebuilds the block's field from the model; false when it is not mounted. */
	private reconcileBlock(
		blockId: string,
		element = this.options.getInlineElement(blockId),
	): boolean {
		const ytext = this.options.getYText(blockId);
		if (!element || !ytext) {
			return false;
		}
		renderFieldFromModel(
			this.editor,
			ytext,
			element,
			inlineDecorationsForBlock(this.editor, blockId),
		);
		this.options.notifyDomReconciled?.(blockId);
		return true;
	}
}
