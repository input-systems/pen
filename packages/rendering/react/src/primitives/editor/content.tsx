import React, { useRef, useSyncExternalStore } from "react";
import { resolveEditorMessage } from "@input/pen-core";
import type { FieldEditorSession } from "@input/pen-dom";
import { EditorContentContext } from "../../context/editorContentContext";
import { useEditorContext } from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";

import { useFieldEditorState } from "../../hooks/useFieldEditorState";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";
import { useBlockList } from "../../hooks/useBlockList";
import {
	useDocumentEmptyState,
	useDocumentPlaceholderTarget,
} from "../../hooks/useDocumentEmptyState";
import { useInlineCompletionState } from "../../hooks/useInlineCompletionState";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import {
	buildDataAttributes,
	DATA_ATTRS,
} from "@input/pen-dom/utils/dataAttributes";
import { fieldEditorTextEntryAttrs } from "../../utils/fieldEditorTextEntryAttrs";
import { AutocompletePreviewBlock } from "./autocompletePreviewBlock";
import { EditorBlock } from "./block";
import { DropPreviewProvider } from "./dropPreviewContext";
import { buildMoveBlockOps, useBlockDragSession } from "./blockDragSession";
import { useEditorRegionSelectionContext } from "./regionSelectionState";
import { useTransferSession } from "./useTransferSession";
import { useEditorContentPointerState } from "./useEditorContentPointerState";
import { useEditorContentGestures } from "./useEditorContentGestures";
import {
	createInlineDropCaretStyle,
	getInlineAtomDropCaretStyle,
	isNoOpBlockMove,
	resolveBlockDropTarget,
	resolveDraggedBlockIdsFromEvent,
	type InlineDropCaretStyle,
} from "./editorContentDropUtils";
import {
	getInlineAtomDragSnapshot,
	subscribeInlineAtomDragSnapshot,
} from "@input/pen-dom";

export interface EditorContentProps extends AsChildProps {
	emptyPlaceholder?: string;
	ref?: React.Ref<HTMLElement>;
}

export function EditorContent(props: EditorContentProps) {
	const { emptyPlaceholder: emptyPlaceholderProp, ...rest } = props;
	const {
		editor,
		readonly,
		blockDragAndDrop,
		blockSelection,
		interactionModel,
	} = useEditorContext();
	const emptyPlaceholder =
		emptyPlaceholderProp ??
		resolveEditorMessage(editor, "pen.schema.document.emptyPlaceholder");
	const fieldEditor = useFieldEditorContext();
	const { store: regionSelectionStore } = useEditorRegionSelectionContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const blockIds = useBlockList(editor);
	const visibleSuggestion = useInlineCompletionState(editor);
	const blockDragSession = useBlockDragSession();
	const contentRef = useRef<HTMLElement>(null);
	const blocksHostRef =
		blockDragSession.blocksHostRef as React.RefObject<HTMLDivElement | null>;
	const {
		regionGestureRef,
		pointerGestureRef,
		pointerGestureVersionRef,
		skipNextClickRef,
		interactionModelRef,
		clearPointerSelectionState,
	} = useEditorContentPointerState(interactionModel);

	const isEmpty = useDocumentEmptyState(editor);
	const documentPlaceholderTargetBlockId =
		useDocumentPlaceholderTarget(editor);
	const {
		isDropActive,
		dropPreview,
		inlineDropCaretStyle: transferInlineDropCaretStyle,
	} = useTransferSession({
		editor,
		readonly,
		contentRef,
	});
	const inlineAtomDragSnapshot = useSyncExternalStore(
		subscribeInlineAtomDragSnapshot,
		getInlineAtomDragSnapshot,
		getInlineAtomDragSnapshot,
	);
	const inlineAtomDropCaretStyle = getInlineAtomDropCaretStyle({
		editor,
		contentElement: contentRef.current,
		snapshot: inlineAtomDragSnapshot,
	});
	const activeInlineDropCaretStyle =
		transferInlineDropCaretStyle ?? inlineAtomDropCaretStyle;
	const isInlineAtomDropActive = inlineAtomDropCaretStyle !== null;

	useIsomorphicLayoutEffect(() => {
		if (!fieldEditor || fieldEditorState.mode !== "expanded") return;
		if (!blocksHostRef.current) return;
		fieldEditor.attachElement(blocksHostRef.current);
	}, [fieldEditor, fieldEditorState.mode, fieldEditorState.activeBlockIds]);

	// no dep array: acks every commit, matching the Vue binding's
	// onMounted + onUpdated pair. A text-only splice leaves blockIds
	// referentially stable but can still replace block DOM nodes.
	useIsomorphicLayoutEffect(() => {
		ackMountedBlockElements(fieldEditor, blocksHostRef.current);
	});

	// Click-to-activate: when user clicks on a block, activate the field editor.
	// Shift-click: select a range of blocks (AC #22).

	useEditorContentGestures({
		editor,
		readonly,
		fieldEditor,
		blockSelection,
		contentRef,
		blocksHostRef,
		regionSelectionStore,
		regionGestureRef,
		pointerGestureRef,
		pointerGestureVersionRef,
		skipNextClickRef,
		interactionModelRef,
		clearPointerSelectionState,
	});

	const blockElements: React.ReactElement[] = [];
	const previewBlocks = visibleSuggestion?.previewBlocks ?? [];
	const anchorBlock = visibleSuggestion
		? editor.getBlock(visibleSuggestion.blockId)
		: null;
	for (const blockId of blockIds) {
		blockElements.push(<EditorBlock key={blockId} blockId={blockId} />);
		if (previewBlocks.length > 0 && blockId === visibleSuggestion?.blockId) {
			const previewBlockElements = previewBlocks.map(
				(previewBlock, previewIndex) => (
					<AutocompletePreviewBlock
						key={`autocomplete-preview:${previewBlock.id}`}
						anchorBlock={anchorBlock}
						anchorBlockType={anchorBlock?.type}
						anchorProps={anchorBlock?.props ?? null}
						block={previewBlock}
						previewIndex={previewIndex}
					/>
				),
			);
			blockElements.push(...previewBlockElements);
		}
	}

	const inlineDropCaret =
		(isDropActive || isInlineAtomDropActive) &&
		activeInlineDropCaretStyle ? (
			<div
				// AX7 overlay — inline drop caret is presentation
				aria-hidden="true"
				{...{ [DATA_ATTRS.dropCaret]: "" }}
				style={createInlineDropCaretStyle(activeInlineDropCaretStyle)}
			/>
		) : null;

	const handleBlockDragOver = (event: React.DragEvent<HTMLElement>) => {
		if (readonly || !blockDragAndDrop.enabled || !blocksHostRef.current) {
			return;
		}

		const draggedBlockIds = resolveDraggedBlockIdsFromEvent(
			event.dataTransfer,
			blockDragSession.viewId,
			blockDragSession.draggedRef.current?.blockIds ?? null,
		);
		if (!draggedBlockIds) {
			return;
		}

		const target = resolveBlockDropTarget({
			blockIds,
			blocksHost: blocksHostRef.current,
			draggedBlockIds,
			clientY: event.clientY,
		});
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = "move";
		}
		if (!target) {
			blockDragSession.clearDropTarget();
			return;
		}
		blockDragSession.setDropTarget(target.blockId, target.position);
	};

	const handleBlockDrop = (event: React.DragEvent<HTMLElement>) => {
		if (readonly || !blockDragAndDrop.enabled || !blocksHostRef.current) {
			return;
		}

		const draggedBlockIds = resolveDraggedBlockIdsFromEvent(
			event.dataTransfer,
			blockDragSession.viewId,
			blockDragSession.draggedRef.current?.blockIds ?? null,
		);
		if (!draggedBlockIds) {
			return;
		}

		const target = resolveBlockDropTarget({
			blockIds,
			blocksHost: blocksHostRef.current,
			draggedBlockIds,
			clientY: event.clientY,
		});
		if (!target) {
			blockDragSession.clearDropTarget();
			blockDragSession.endDrag();
			return;
		}

		const moveOps = buildMoveBlockOps({
			blockIds: draggedBlockIds,
			targetBlockId: target.blockId,
			dropPosition: target.position,
		});
		if (
			moveOps.length === 0 ||
			isNoOpBlockMove(editor.documentState.blockOrder, moveOps)
		) {
			blockDragSession.clearDropTarget();
			blockDragSession.endDrag();
			return;
		}

		event.preventDefault();
		editor.apply(moveOps, { origin: "user" });
		blockDragSession.clearDropTarget();
		blockDragSession.endDrag();
	};

	const handleBlockDragLeave = (event: React.DragEvent<HTMLElement>) => {
		const relatedTarget = event.relatedTarget;
		if (
			relatedTarget instanceof Node &&
			event.currentTarget.contains(relatedTarget)
		) {
			return;
		}
		blockDragSession.clearDropTarget();
	};

	const contentChildren = (
		<>
			<div
				data-pen-editor-blocks-host=""
				{...(fieldEditorState.mode === "expanded"
					? {
							[DATA_ATTRS.fieldEditorSurface]: "",
							...fieldEditorTextEntryAttrs(true, editor),
						}
					: {})}
				ref={blocksHostRef}
			>
				{blockElements}
			</div>
			{inlineDropCaret}
			{rest.children}
		</>
	);

	const primitiveProps: Record<string, unknown> = {
		[DATA_ATTRS.editorContent]: "",
		...buildDataAttributes({
			"drop-target": isDropActive || isInlineAtomDropActive,
			empty: isEmpty,
		}),
		onDragOver: handleBlockDragOver,
		onDrop: handleBlockDrop,
		onDragLeave: handleBlockDragLeave,
	};

	return (
		<EditorContentContext.Provider
			value={{ emptyPlaceholder, documentPlaceholderTargetBlockId }}
		>
			<DropPreviewProvider value={dropPreview}>
				{renderAsChild(
					{
						...rest,
						ref: contentRef,
						children: contentChildren,
					},
					"div",
					primitiveProps,
				)}
			</DropPreviewProvider>
		</EditorContentContext.Provider>
	);
}

function ackMountedBlockElements(
	fieldEditor: FieldEditorSession | null,
	host: HTMLElement | null,
): void {
	if (!fieldEditor || !host) {
		return;
	}
	for (const element of host.querySelectorAll(
		`[${DATA_ATTRS.editorBlock}]`,
	)) {
		if (!(element instanceof HTMLElement)) {
			continue;
		}
		const blockId = element.getAttribute(DATA_ATTRS.blockId);
		if (blockId) {
			fieldEditor.ackBlockMounted(blockId, element);
		}
	}
}
