import React, {
	createContext,
	useContext,
	useId,
	useRef,
	useState,
} from "react";
import {
	foldAndNormalize,
	localeFacet,
	resolveEditorMessage,
} from "@input/pen-core";
import type { AICommandBinding } from "@input/pen-ai";
import {
	captureFocusReturn,
	restoreFocusReturn,
	type FocusReturnToken,
} from "@input/pen-dom";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import { resolveChromeEditorRoot } from "../../utils/aiDomScope";
import { getAttachedFieldEditorSession } from "../../utils/fieldEditor";
import { useAIContext } from "./root";

interface CommandMenuContextValue {
	filter: string;
	setFilter: (value: string) => void;
	commands: readonly AICommandBinding[];
	selectedIndex: number;
	setSelectedIndex: (index: number) => void;
	listId: string;
	getOptionId: (index: number) => string;
	activeOptionId: string | undefined;
	open: boolean;
	/** AX3: return focus to what held it when the menu opened. */
	returnFocus: () => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

function useCommandMenuContext(): CommandMenuContextValue {
	const ctx = useContext(CommandMenuContext);
	if (!ctx) {
		throw new Error("Missing command menu context");
	}
	return ctx;
}

function commandOptionId(listId: string, index: number): string {
	return `${listId}-option-${index}`;
}

export interface AICommandMenuProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

/**
 * AX3 command palette: combobox + listbox, activedescendant while a list exists.
 * Arrow/Home/End move the active option; Enter/Tab run it; Escape closes.
 * Focus stays in the filter input while open; accepting a command or Escape
 * returns it to whatever held it when the menu opened (D15).
 */
export function AICommandMenu(props: AICommandMenuProps) {
	const { ref, ...rest } = props;
	const { controller, editor, state } = useAIContext();
	const fieldEditorContext = useFieldEditorContext();
	const menuRef = useRef<HTMLElement | null>(null);
	const focusReturnRef = useRef<FocusReturnToken | null>(null);
	const [filter, setFilter] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const listId = useId();
	const commandContext = controller?.getCommandContext();
	const allCommands = controller?.getCommands() ?? [];
	const locale = editor.facet(localeFacet);
	const foldedFilter = foldAndNormalize(filter.trim(), locale);
	const commands =
		foldedFilter.length === 0
			? allCommands
			: allCommands.filter((command) => {
					const haystack = foldAndNormalize(
						[command.label, command.description, command.group]
							.filter(Boolean)
							.join(" "),
						locale,
					);
					return haystack.includes(foldedFilter);
				});
	const activeIndex =
		commands.length === 0
			? 0
			: Math.min(selectedIndex, commands.length - 1);
	const getOptionId = (index: number) => commandOptionId(listId, index);
	const activeOptionId =
		state.commandMenuOpen && commands.length > 0
			? getOptionId(activeIndex)
			: undefined;

	function resolveRoot(): HTMLElement | null {
		return resolveChromeEditorRoot(editor, menuRef.current);
	}

	function returnFocus() {
		const token = focusReturnRef.current;
		focusReturnRef.current = null;
		if (!token) {
			return;
		}
		restoreFocusReturn(
			token,
			fieldEditorContext ?? getAttachedFieldEditorSession(editor),
			"target",
			{ owner: menuRef.current },
		);
	}

	function updateFilter(value: string) {
		setFilter(value);
		setSelectedIndex(0);
	}

	function moveSelection(key: "ArrowDown" | "ArrowUp" | "Home" | "End") {
		if (commands.length === 0) {
			return;
		}
		const from = activeIndex;
		let next = from;
		switch (key) {
			case "ArrowDown":
				next = (from + 1) % commands.length;
				break;
			case "ArrowUp":
				next = (from - 1 + commands.length) % commands.length;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = commands.length - 1;
				break;
			default: {
				const _exhaustive: never = key;
				return _exhaustive;
			}
		}
		setSelectedIndex(next);
	}

	function runSelected() {
		const command = commands[activeIndex];
		if (!command) {
			return;
		}
		controller?.closeCommandMenu();
		returnFocus();
		void controller?.runCommand(command.id);
	}

	function handleMenuKeyDown(event: React.KeyboardEvent<HTMLElement>) {
		if (!state.commandMenuOpen) {
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return;
		}

		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp":
			case "Home":
			case "End":
				event.preventDefault();
				event.stopPropagation();
				moveSelection(event.key);
				break;
			case "Enter":
			case "Tab":
				event.preventDefault();
				event.stopPropagation();
				runSelected();
				break;
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				controller?.closeCommandMenu();
				returnFocus();
				break;
			default:
				break;
		}
	}

	// Record what holds focus as the menu opens, before the host moves it
	// into the filter input. Focus already inside the menu is not a target.
	useIsomorphicLayoutEffect(() => {
		if (!state.commandMenuOpen) {
			focusReturnRef.current = null;
			return;
		}
		const root = resolveRoot();
		if (!root) {
			return;
		}
		const token = captureFocusReturn(root);
		const insideMenu =
			token.target !== null && menuRef.current?.contains(token.target);
		focusReturnRef.current = insideMenu
			? captureFocusReturn(root, null)
			: token;
	}, [state.commandMenuOpen]);

	const menuProps: AsChildProps & {
		ref?: React.Ref<HTMLElement>;
	} & Record<string, unknown> = {
		...rest,
		ref: composeRefs(ref, menuRef),
		hidden: !state.commandMenuOpen,
		onKeyDown: handleMenuKeyDown,
	};

	return (
		<CommandMenuContext.Provider
			value={{
				filter,
				setFilter: updateFilter,
				commands,
				selectedIndex: activeIndex,
				setSelectedIndex,
				listId,
				getOptionId,
				activeOptionId,
				open: state.commandMenuOpen,
				returnFocus,
			}}
		>
			{renderAsChild(menuProps, "div", {
				"data-pen-ai-command-menu": "",
				"data-open": state.commandMenuOpen ? "" : undefined,
				"data-block-id": commandContext?.blockId ?? undefined,
				role: "menu",
				"aria-activedescendant": activeOptionId,
			})}
		</CommandMenuContext.Provider>
	);
}

export interface AICommandInputProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

export function AICommandInput(props: AICommandInputProps) {
	const { editor } = useAIContext();
	const { filter, setFilter, listId, activeOptionId, open } =
		useCommandMenuContext();
	const inputId = useId();
	const inputProps: AsChildProps & {
		ref?: React.Ref<HTMLElement>;
	} & Record<string, unknown> = {
		...props,
		id: inputId,
		value: filter,
		onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
			setFilter(event.target.value),
	};
	return renderAsChild(inputProps, "input", {
		type: "text",
		role: "combobox",
		"aria-autocomplete": "list",
		"aria-controls": listId,
		"aria-expanded": open,
		"aria-activedescendant": activeOptionId,
		placeholder: resolveEditorMessage(
			editor,
			"pen.ai.commandMenu.placeholder",
		),
		"data-pen-ai-command-input": "",
	});
}

export interface AICommandListProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

export function AICommandList(props: AICommandListProps) {
	const { editor } = useAIContext();
	const { commands, listId, activeOptionId } = useCommandMenuContext();
	const commandItems = commands.map((command) => (
		<AICommandItem key={command.id} command={command} />
	));

	return renderAsChild(
		{
			...props,
			children: commandItems,
		},
		"div",
		{
			id: listId,
			role: "listbox",
			"aria-label": resolveEditorMessage(
				editor,
				"pen.ai.commandMenu.label",
			),
			"aria-activedescendant": activeOptionId,
			"data-pen-ai-command-list": "",
		},
	);
}

export interface AICommandItemProps extends AsChildProps {
	command: AICommandBinding;
	ref?: React.Ref<HTMLElement>;
}

export function AICommandItem(props: AICommandItemProps) {
	const { command, ...rest } = props;
	const { controller } = useAIContext();
	const {
		commands,
		selectedIndex,
		setSelectedIndex,
		getOptionId,
		returnFocus,
	} = useCommandMenuContext();
	const itemIndex = commands.findIndex((item) => item.id === command.id);
	const isSelected = itemIndex >= 0 && itemIndex === selectedIndex;
	const optionId = itemIndex >= 0 ? getOptionId(itemIndex) : undefined;
	const itemProps: AsChildProps & {
		ref?: React.Ref<HTMLElement>;
	} & Record<string, unknown> = {
		...rest,
		onClick: () => {
			controller?.closeCommandMenu();
			returnFocus();
			void controller?.runCommand(command.id);
		},
		onMouseEnter: () => {
			if (itemIndex >= 0) {
				setSelectedIndex(itemIndex);
			}
		},
		children: props.children ?? command.label,
	};

	return renderAsChild(itemProps, "div", {
		id: optionId,
		role: "option",
		tabIndex: -1,
		"aria-selected": isSelected,
		"data-pen-ai-command-item": "",
		"data-command-id": command.id,
		"data-command-group": command.group ?? undefined,
		"data-selected": isSelected ? "" : undefined,
	});
}
