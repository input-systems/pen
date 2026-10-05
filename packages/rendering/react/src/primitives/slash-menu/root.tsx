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
	useSlashMenu,
	type SlashMenuState,
	type SlashMenuActions,
} from "../../hooks/useSlashMenu";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import {
	applySlashMenuFieldAria,
	clearSlashMenuFieldAria,
	getSlashMenuOptionId,
	resolveSlashMenuField,
} from "./popupAria";
import { resolveEditorOwnerDocument } from "../../utils/aiDomScope";

export type SlashMenuController = SlashMenuState &
	SlashMenuActions & {
		editor?: Editor;
	};

export type SlashMenuContextValue = SlashMenuController & {
	listboxId: string;
};

export { getSlashMenuOptionId };

const SlashMenuContext = createContext<SlashMenuContextValue | null>(null);

export function useSlashMenuContext(): SlashMenuContextValue {
	const ctx = useContext(SlashMenuContext);
	if (!ctx) {
		throw new Error("Missing Pen.SlashMenu.Root context");
	}
	return ctx;
}

export interface SlashMenuRootProps extends AsChildProps {
	controller?: SlashMenuController;
	editor?: Editor;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	ref?: React.Ref<HTMLElement>;
}

export function SlashMenuRoot(props: SlashMenuRootProps) {
	const { controller, editor, ...rest } = props;
	if (controller) {
		return (
			<SlashMenuRootContent
				{...rest}
				controller={controller}
				editor={editor}
			/>
		);
	}

	return <UncontrolledSlashMenuRoot {...rest} editor={editor} />;
}

type UncontrolledSlashMenuRootProps = Omit<SlashMenuRootProps, "controller">;

function UncontrolledSlashMenuRoot(props: UncontrolledSlashMenuRootProps) {
	const { editor: editorProp, ...rest } = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? editorContext?.editor;

	if (!editor) {
		throw new Error("Missing editor for Pen.SlashMenu.Root");
	}

	const menuState = useSlashMenu(editor);

	return (
		<SlashMenuRootContent
			{...rest}
			controller={menuState}
			editor={editor}
		/>
	);
}

type SlashMenuRootContentProps = Omit<
	SlashMenuRootProps,
	"controller" | "editor"
> & {
	controller: SlashMenuController;
	editor?: Editor;
};

function SlashMenuRootContent(props: SlashMenuRootContentProps) {
	const {
		controller,
		editor: editorProp,
		open: controlledOpen,
		onOpenChange,
		...rest
	} = props;
	const editorContext = useContext(EditorContext);
	const fieldEditor = useFieldEditorContext();
	const editor = editorProp ?? controller.editor ?? editorContext?.editor;
	const listboxId = useId();
	const rootRef = useRef<HTMLElement | null>(null);
	const annotatedFieldRef = useRef<HTMLElement | null>(null);

	const isOpen = controlledOpen ?? controller.open;

	const wrappedState: SlashMenuContextValue = {
		...controller,
		editor,
		listboxId,
		open: isOpen,
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
		if (!isOpen) return;

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
					wrappedStateRef.current = {
						...currentState,
						selectedIndex: 0,
					};
					currentState.select(0);
					break;
				}
				case "End": {
					event.preventDefault();
					event.stopPropagation();
					const lastIndex =
						currentState.items.length === 0
							? 0
							: currentState.items.length - 1;
					wrappedStateRef.current = {
						...currentState,
						selectedIndex: lastIndex,
					};
					currentState.select(lastIndex);
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
		return () =>
			doc.removeEventListener("keydown", handleKeyDown, true);
	}, [editor, isOpen]);

	useEffect(() => {
		const syncFieldAria = () => {
			const field = isOpen
				? resolveSlashMenuField(rootRef.current)
				: null;
			const previous = annotatedFieldRef.current;
			if (previous && previous !== field) {
				clearSlashMenuFieldAria(previous);
			}
			if (!isOpen || !field) {
				clearSlashMenuFieldAria(field ?? previous);
				annotatedFieldRef.current = null;
				return;
			}
			const activeOptionId =
				controller.items.length > 0
					? getSlashMenuOptionId(listboxId, controller.selectedIndex)
					: undefined;
			applySlashMenuFieldAria(field, listboxId, activeOptionId);
			annotatedFieldRef.current = field;
		};

		syncFieldAria();
		const unsubscribe = fieldEditor?.subscribe(syncFieldAria);
		return () => {
			unsubscribe?.();
			clearSlashMenuFieldAria(annotatedFieldRef.current);
			annotatedFieldRef.current = null;
		};
	}, [
		controller.items.length,
		controller.selectedIndex,
		fieldEditor,
		isOpen,
		listboxId,
	]);

	const primitiveProps: Record<string, unknown> = {
		"data-pen-slash-menu": "",
		"data-open": isOpen ? "" : undefined,
	};

	return (
		<SlashMenuContext.Provider value={wrappedState}>
			{renderAsChild(
				{ ...rest, ref: composeRefs(rest.ref, rootRef) },
				"div",
				primitiveProps,
			)}
		</SlashMenuContext.Provider>
	);
}

