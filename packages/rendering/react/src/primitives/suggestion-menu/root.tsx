import React, {
	createContext,
	useContext,
	useEffect,
	useId,
	useRef,
} from "react";
import type { Editor } from "@input/pen-types";
import { EditorContext } from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import {
	useSuggestionMenu,
	type SuggestionMenuActions,
	type SuggestionMenuController,
	type SuggestionMenuState,
	type UseSuggestionMenuOptions,
} from "../../hooks/useSuggestionMenu";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import {
	applySuggestionMenuFieldAria,
	clearSuggestionMenuFieldAria,
	resolveSuggestionMenuField,
	suggestionMenuOptionId,
} from "./popupAria";
import { resolveEditorOwnerDocument } from "../../utils/aiDomScope";

export type SuggestionMenuContextValue<TItem = unknown> =
	SuggestionMenuState<TItem> &
		SuggestionMenuActions & {
			editor?: Editor;
			popupId: string;
			getOptionId: (index: number) => string;
		};

const SuggestionMenuContext =
	createContext<SuggestionMenuContextValue<unknown> | null>(null);

export function useSuggestionMenuContext<
	TItem = unknown,
>(): SuggestionMenuContextValue<TItem> {
	const context = useContext(SuggestionMenuContext);
	if (!context) {
		throw new Error("Missing Pen.SuggestionMenu.Root context");
	}
	return context as SuggestionMenuContextValue<TItem>;
}

export interface SuggestionMenuRootProps<TItem = unknown> extends AsChildProps {
	controller?: SuggestionMenuController<TItem>;
	editor?: Editor;
	options?: UseSuggestionMenuOptions<TItem>;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	ref?: React.Ref<HTMLElement>;
}

export function SuggestionMenuRoot<TItem = unknown>(
	props: SuggestionMenuRootProps<TItem>,
) {
	const { controller, editor, options, ...rest } = props;
	if (controller) {
		return (
			<SuggestionMenuRootContent
				{...rest}
				controller={controller}
				editor={editor}
			/>
		);
	}
	if (options) {
		return (
			<UncontrolledSuggestionMenuRoot
				{...rest}
				editor={editor}
				options={options}
			/>
		);
	}

	throw new Error("Missing Pen.SuggestionMenu.Root controller");
}

type UncontrolledSuggestionMenuRootProps<TItem> = Omit<
	SuggestionMenuRootProps<TItem>,
	"controller"
> & {
	options: UseSuggestionMenuOptions<TItem>;
};

function UncontrolledSuggestionMenuRoot<TItem>(
	props: UncontrolledSuggestionMenuRootProps<TItem>,
) {
	const { editor: editorProp, options, ...rest } = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? options.editor ?? editorContext?.editor;

	if (!editor) {
		throw new Error("Missing editor for Pen.SuggestionMenu.Root");
	}

	const controller = useSuggestionMenu({
		...options,
		editor,
	});

	return (
		<SuggestionMenuRootContent
			{...rest}
			controller={controller}
			editor={editor}
		/>
	);
}

type SuggestionMenuRootContentProps<TItem> = Omit<
	SuggestionMenuRootProps<TItem>,
	"controller" | "editor" | "options"
> & {
	controller: SuggestionMenuController<TItem>;
	editor?: Editor;
};

function SuggestionMenuRootContent<TItem>(
	props: SuggestionMenuRootContentProps<TItem>,
) {
	const {
		controller,
		editor: editorProp,
		open: controlledOpen,
		onOpenChange,
		ref,
		...rest
	} = props;
	const editorContext = useContext(EditorContext);
	const fieldEditor = useFieldEditorContext();
	const editor = editorProp ?? editorContext?.editor;
	const isOpen = controlledOpen ?? controller.open;
	const popupId = useId();
	const rootRef = useRef<HTMLElement | null>(null);
	const annotatedFieldRef = useRef<HTMLElement | null>(null);
	const getOptionId = (index: number) =>
		suggestionMenuOptionId(popupId, index);

	const wrappedState: SuggestionMenuContextValue<TItem> = {
		...controller,
		editor,
		open: isOpen,
		popupId,
		getOptionId,
		dismiss: () => {
			controller.dismiss();
			onOpenChange?.(false);
		},
		confirm: (index?: number) => {
			const didConfirm = controller.confirm(index);
			if (didConfirm) {
				onOpenChange?.(false);
			}
			return didConfirm;
		},
	};
	const wrappedStateRef = useRef(wrappedState);
	wrappedStateRef.current = wrappedState;

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			const currentState = wrappedStateRef.current;
			if (event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}

			switch (event.key) {
				case "ArrowDown": {
					event.preventDefault();
					event.stopPropagation();
					const nextIndex =
						currentState.items.length === 0
							? 0
							: (currentState.selectedIndex + 1) %
								currentState.items.length;
					wrappedStateRef.current = {
						...currentState,
						selectedIndex: nextIndex,
					};
					currentState.select(nextIndex);
					break;
				}
				case "ArrowUp": {
					event.preventDefault();
					event.stopPropagation();
					const nextIndex =
						currentState.items.length === 0
							? 0
							: (currentState.selectedIndex -
									1 +
									currentState.items.length) %
								currentState.items.length;
					wrappedStateRef.current = {
						...currentState,
						selectedIndex: nextIndex,
					};
					currentState.select(nextIndex);
					break;
				}
				case "Home": {
					event.preventDefault();
					event.stopPropagation();
					const nextIndex = 0;
					wrappedStateRef.current = {
						...currentState,
						selectedIndex: nextIndex,
					};
					currentState.select(nextIndex);
					break;
				}
				case "End": {
					event.preventDefault();
					event.stopPropagation();
					const nextIndex = Math.max(
						0,
						currentState.items.length - 1,
					);
					wrappedStateRef.current = {
						...currentState,
						selectedIndex: nextIndex,
					};
					currentState.select(nextIndex);
					break;
				}
				case "Enter":
				case "Tab":
					event.preventDefault();
					event.stopPropagation();
					currentState.confirm(currentState.selectedIndex);
					break;
				case "Escape":
					event.preventDefault();
					event.stopPropagation();
					currentState.dismiss();
					break;
			}
		};

		const doc = resolveEditorOwnerDocument(editor);
		doc.addEventListener("keydown", handleKeyDown, true);
		return () => {
			doc.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [editor, isOpen]);

	// ax3: caret-anchored popup; dom focus stays in the editing field
	useEffect(() => {
		const syncFieldAria = () => {
			const field = isOpen
				? resolveSuggestionMenuField(rootRef.current)
				: null;
			const previous = annotatedFieldRef.current;
			if (previous && previous !== field) {
				clearSuggestionMenuFieldAria(previous);
			}
			if (!isOpen || !field) {
				clearSuggestionMenuFieldAria(field ?? previous);
				annotatedFieldRef.current = null;
				return;
			}
			const activeOptionId =
				controller.items.length > 0
					? suggestionMenuOptionId(popupId, controller.selectedIndex)
					: undefined;
			applySuggestionMenuFieldAria(field, popupId, activeOptionId);
			annotatedFieldRef.current = field;
		};

		syncFieldAria();
		const unsubscribe = fieldEditor?.subscribe(syncFieldAria);
		return () => {
			unsubscribe?.();
			clearSuggestionMenuFieldAria(annotatedFieldRef.current);
			annotatedFieldRef.current = null;
		};
	}, [
		controller.items.length,
		controller.selectedIndex,
		fieldEditor,
		isOpen,
		popupId,
	]);

	const primitiveProps: Record<string, unknown> = {
		"data-pen-suggestion-menu": "",
		"data-open": isOpen ? "" : undefined,
		"data-trigger": controller.target?.trigger,
	};

	return (
		<SuggestionMenuContext.Provider
			value={wrappedState as SuggestionMenuContextValue<unknown>}
		>
			{renderAsChild(
				{ ...rest, ref: composeRefs(ref, rootRef) },
				"div",
				primitiveProps,
			)}
		</SuggestionMenuContext.Provider>
	);
}

