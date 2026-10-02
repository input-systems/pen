import React, { useRef, useEffect, useState } from "react";
import {
	ariaReadOnlyFacet,
	clipboardFacet,
	resolveEditorA11yLabel,
} from "@input/pen-core";
import { FIELD_EDITOR_SLOT_KEY } from "@input/pen-types";
import type {
	AssetProvider,
	Editor,
	EditorViewMode,
	InteractionModel,
} from "@input/pen-types";
import {
	EditorContext,
	type BlockControlsRenderer,
	type BlockDragAndDropOptions,
	type BlockSelectionOptions,
	type InlineAtomInteractions,
	type InlineAtomRenderers,
	type ResolvedBlockDragAndDropOptions,
	type PasteImporters,
	type RendererOverrides,
	resolveBlockSelection,
	resolveInlineAtomInteractions,
	resolveInteractionModel,
} from "../../context/editorContext";
import { FieldEditorContext } from "../../context/fieldEditorContext";
import {
	adoptEditorChrome,
	bindEditorDocumentKeyDown,
	FieldEditorImpl,
	handleFieldEditorRootFocus,
	RegionSelectionStore,
	registerInlineAtomInteractionRoot,
	registerVerticalCaretMeasure,
	type FieldEditorSession,
	type PenFocusLifecycleListener,
	type PenFocusPolicy,
} from "@input/pen-dom";
import { useDocumentEmptyState } from "../../hooks/useDocumentEmptyState";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";
import { EditorRegionSelectionContext } from "./regionSelectionState";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import {
	buildDataAttributes,
	DATA_ATTRS,
} from "@input/pen-dom/utils/dataAttributes";
import { BlockDragSessionProvider } from "./blockDragSession";

export interface EditorRootProps extends AsChildProps {
	editor: Editor;
	readonly?: boolean;
	focusPolicy?: PenFocusPolicy;
	onFocusLifecycle?: PenFocusLifecycleListener;
	importers?: PasteImporters;
	assets?: AssetProvider;
	renderers?: RendererOverrides;
	inlineAtomRenderers?: InlineAtomRenderers;
	inlineAtomInteractions?: InlineAtomInteractions;
	blockControls?: BlockControlsRenderer;
	editorViewMode?: EditorViewMode;
	interactionModel?: InteractionModel;
	blockDragAndDrop?: BlockDragAndDropOptions;
	blockSelection?: BlockSelectionOptions;
	/**
	 * Adopt the editor chrome stylesheet. Default `true` so `PenEditor` /
	 * `Editor.Root` is a usable field. Pass `false` for the unstyled HOST6 path.
	 */
	chrome?: boolean;
	ref?: React.Ref<HTMLElement>;
}

export function EditorRoot(props: EditorRootProps) {
	const {
		editor,
		readonly = false,
		focusPolicy,
		onFocusLifecycle,
		importers,
		assets,
		renderers,
		inlineAtomRenderers,
		inlineAtomInteractions,
		blockControls,
		editorViewMode = editor.editorViewMode,
		interactionModel,
		blockDragAndDrop,
		blockSelection,
		chrome = true,
		ref,
		...rest
	} = props;
	const resolvedBlockDragAndDrop = resolveBlockDragAndDrop(
		editorViewMode,
		blockDragAndDrop,
	);
	const resolvedInteractionModel = resolveInteractionModel(
		editorViewMode,
		interactionModel,
	);
	const resolvedBlockSelection = resolveBlockSelection(blockSelection);
	const resolvedInlineAtomInteractions = resolveInlineAtomInteractions(
		inlineAtomInteractions,
	);
	const [focused, setFocused] = useState(false);
	const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
	const isEmpty = useDocumentEmptyState(editor);
	const fieldEditorRef = useRef<FieldEditorSession | null>(null);
	const regionSelectionStoreRef = useRef<RegionSelectionStore | null>(null);
	const rootRef = useRef<HTMLElement | null>(null);
	const mountedEditorRef = useRef<Editor>(editor);
	const resolvedAssets = assets ?? importers?.assets;

	if (!fieldEditorRef.current) {
		const fieldEditorOptions = {
			selectAllBehavior: resolvedInteractionModel.selectAllBehavior,
			focusPolicy,
		};
		fieldEditorRef.current = new FieldEditorImpl(
			editor,
			fieldEditorOptions,
		);
	}
	if (!regionSelectionStoreRef.current) {
		regionSelectionStoreRef.current = new RegionSelectionStore();
	}

	useIsomorphicLayoutEffect(() => {
		if (chrome === false) {
			return;
		}
		const doc = rootElement?.ownerDocument;
		if (!doc) {
			return;
		}
		return adoptEditorChrome(doc);
	}, [chrome, rootElement]);

	useEffect(() => {
		fieldEditorRef.current?.setSelectAllBehavior(
			resolvedInteractionModel.selectAllBehavior,
		);
	}, [resolvedInteractionModel.selectAllBehavior]);

	useEffect(() => {
		fieldEditorRef.current?.setFocusPolicy(focusPolicy);
	}, [focusPolicy]);

	useEffect(() => {
		if (!onFocusLifecycle) {
			return;
		}
		return fieldEditorRef.current?.onFocusLifecycle(onFocusLifecycle);
	}, [onFocusLifecycle]);

	useEffect(() => {
		const root = rootElement;
		const fieldEditor = fieldEditorRef.current;
		if (!root || !fieldEditor) {
			return;
		}

		const handleFocusIn = (event: FocusEvent) => {
			setFocused(true);
			fieldEditor.setFocused(true);
			handleFieldEditorRootFocus({
				event,
				editor,
				fieldEditor,
				root,
				readonly,
			});
		};

		const handleFocusOut = () => {
			const ownerDocument = root.ownerDocument;
			const activeElement = ownerDocument?.activeElement;
			const nextFocused =
				activeElement instanceof Node && root.contains(activeElement);
			setFocused(nextFocused);
			fieldEditor.setFocused(nextFocused);
		};

		root.addEventListener("focusin", handleFocusIn);
		root.addEventListener("focusout", handleFocusOut);

		return () => {
			root.removeEventListener("focusin", handleFocusIn);
			root.removeEventListener("focusout", handleFocusOut);
		};
	}, [editor, readonly, rootElement]);

	useEffect(() => {
		let previousImporters: unknown;
		let wroteImporters = false;
		if (importers) {
			previousImporters = editor.facet(clipboardFacet);
			const base =
				previousImporters && !Array.isArray(previousImporters)
					? previousImporters
					: {};
			const host = Object.fromEntries(
				Object.entries(importers).filter(([, value]) => value != null),
			);
			editor.internals.assignSlot("paste:importers", {
				...base,
				...host,
			});
			wroteImporters = true;
		}
		editor.internals.assignSlot("paste:assetProvider", resolvedAssets);

		return () => {
			if (wroteImporters) {
				editor.internals.assignSlot(
					"paste:importers",
					previousImporters,
				);
			}
			editor.internals.assignSlot("paste:assetProvider", undefined);
		};
	}, [editor, importers, resolvedAssets]);

	useEffect(() => {
		editor.internals.assignSlot(
			FIELD_EDITOR_SLOT_KEY,
			fieldEditorRef.current,
		);
		return () => {
			editor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, undefined);
			fieldEditorRef.current?.destroy();
		};
	}, [editor]);

	/*
	 * One root, one editor. The field editor and the rendered DOM below it are
	 * built for the instance this root mounted with, so a swapped-in editor gets
	 * driven by the previous one — dead keystrokes and selections projected into
	 * a document that has never heard of those block ids. There is no silent
	 * recovery, so say so instead of leaving the host to find it by hand.
	 */
	useEffect(() => {
		if (mountedEditorRef.current === editor) {
			return;
		}
		mountedEditorRef.current = editor;
		editor.internals.emit("diagnostic", {
			code: "editor-root-editor-replaced",
			level: "error",
			source: "rendering",
			message:
				"Pen.Editor.Root received a different editor than it mounted with.",
			remediation:
				"Give Pen.Editor.Root a key tied to the editor instance so it remounts, for example key={editor.internals.viewId}.",
		});
	}, [editor]);

	useEffect(() => {
		fieldEditorRef.current?.setRootElement(rootRef.current);
		setRootElement(rootRef.current);
		return () => {
			fieldEditorRef.current?.setRootElement(null);
			setRootElement(null);
		};
	}, []);

	useEffect(() => {
		const root = rootElement;
		if (!root) {
			return;
		}

		return registerInlineAtomInteractionRoot(root, {
			editor,
			readonly,
			interactions: resolvedInlineAtomInteractions,
		});
	}, [editor, readonly, resolvedInlineAtomInteractions, rootElement]);

	useEffect(() => {
		const root = rootElement;
		if (!root) {
			return;
		}

		return registerVerticalCaretMeasure(editor, root);
	}, [editor, rootElement]);

	useEffect(() => {
		const root = rootElement;
		const fieldEditor = fieldEditorRef.current;
		if (!root || !fieldEditor) {
			return;
		}

		return bindEditorDocumentKeyDown({
			editor,
			fieldEditor,
			root,
			getInteractionModel: () => resolvedInteractionModel.model,
		});
	}, [editor, resolvedInteractionModel.model, rootElement]);

	const primitiveProps: Record<string, unknown> = {
		[DATA_ATTRS.editorRoot]: "",
		[DATA_ATTRS.viewId]: editor.internals.viewId,
		...buildDataAttributes({
			[DATA_ATTRS.focused]: focused,
			[DATA_ATTRS.readonly]: readonly,
			[DATA_ATTRS.empty]: isEmpty,
		}),
		tabIndex: focused ? -1 : 0,
		role: "textbox",
		"aria-multiline": true,
		...resolveEditorA11yLabel(editor),
		"aria-readonly":
			readonly || editor.facet(ariaReadOnlyFacet) || undefined,
	};

	return (
		<EditorContext.Provider
			value={{
				editor,
				readonly,
				documentProfile: editor.documentProfile,
				editorViewMode,
				interactionModel: resolvedInteractionModel,
				blockDragAndDrop: resolvedBlockDragAndDrop,
				blockSelection: resolvedBlockSelection,
				blockControls,
				importers,
				assets: resolvedAssets,
				renderers,
				inlineAtomRenderers,
				inlineAtomInteractions: resolvedInlineAtomInteractions,
			}}
		>
			<BlockDragSessionProvider viewId={editor.internals.viewId}>
				<EditorRegionSelectionContext.Provider
					value={{
						rootElement,
						setRootElement,
						store: regionSelectionStoreRef.current,
					}}
				>
					<FieldEditorContext.Provider value={fieldEditorRef.current}>
						{renderAsChild(
							{
								...rest,
								ref: composeRefs(ref, rootRef),
							},
							"div",
							primitiveProps,
						)}
					</FieldEditorContext.Provider>
				</EditorRegionSelectionContext.Provider>
			</BlockDragSessionProvider>
		</EditorContext.Provider>
	);
}

function resolveBlockDragAndDrop(
	editorViewMode: EditorViewMode,
	blockDragAndDrop?: BlockDragAndDropOptions,
): ResolvedBlockDragAndDropOptions {
	if (blockDragAndDrop?.enabled != null) {
		return { enabled: blockDragAndDrop.enabled };
	}

	return {
		enabled: editorViewMode !== "flow",
	};
}
