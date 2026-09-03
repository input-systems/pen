import type { ReactNode } from "react";
import { convertBlock, getCommandRegistry } from "@input/pen-core";
import { Pen, useToolbarContext } from "@input/pen-react";
import type { Editor } from "@input/pen-types";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { keepCaret } from "../ui/keepCaret";
import { Select } from "../ui/Select";
import { useUndoState } from "./useUndoState";

interface FormatToolbarProps {
	editor: Editor;
	inspectorOpen: boolean;
	collaborationLive: boolean;
	onOpenCollaborate: () => void;
	onToggleInspector: () => void;
	onOpenInlinePrompt: () => void;
}

/**
 * The marks the default schema ships, with the bindings Pen's keymap gives them
 * (`packages/rendering/dom/src/keymap/defaultKeymap.ts`). Strikethrough and code
 * have no default binding, so their tooltips show no key.
 */
const INLINE_MARKS = [
	{ format: "bold", label: "Bold", shortcut: "Mod-b", icon: <Icon.Bold /> },
	{
		format: "italic",
		label: "Italic",
		shortcut: "Mod-i",
		icon: <Icon.Italic />,
	},
	{
		format: "underline",
		label: "Underline",
		shortcut: "Mod-u",
		icon: <Icon.Underline />,
	},
	{
		format: "strikethrough",
		label: "Strikethrough",
		icon: <Icon.Strikethrough />,
	},
	{ format: "code", label: "Code", icon: <Icon.Code /> },
];

export function FormatToolbar({
	editor,
	inspectorOpen,
	collaborationLive,
	onOpenCollaborate,
	onToggleInspector,
	onOpenInlinePrompt,
}: FormatToolbarProps) {
	const undoState = useUndoState(editor);

	// The glyph colour says collaboration is live; the name is how a screen
	// reader finds out.
	const collaborationLabel = collaborationLive
		? "Collaboration"
		: "Start collaboration";

	const markToggles = INLINE_MARKS.map((mark) => (
		<MarkToggle
			key={mark.format}
			format={mark.format}
			label={mark.label}
			shortcut={mark.shortcut}
		>
			{mark.icon}
		</MarkToggle>
	));

	return (
		<header className="top-bar">
			{/* `Pen.Toolbar.Root` provides the formatting state and arrow-key
			    navigation. It reads the block type options from the schema. */}
			<Pen.Toolbar.Root editor={editor}>
				<BlockTypeSelect />
				<Pen.Toolbar.Group>{markToggles}</Pen.Toolbar.Group>
				<Button.Tooltip content="Ask AI" shortcut="Mod-j">
					<Button.Icon
						label="Ask AI"
						onMouseDown={keepCaret}
						onClick={onOpenInlinePrompt}
					>
						<Icon.PenMagic />
					</Button.Icon>
				</Button.Tooltip>
			</Pen.Toolbar.Root>

			<div className="top-bar-actions">
				<Button.Tooltip content="Undo" shortcut="Mod-z">
					<Button.Icon
						label="Undo"
						disabled={!undoState.canUndo}
						onMouseDown={keepCaret}
						onClick={() => editor.undoManager.undo()}
					>
						<Icon.Undo />
					</Button.Icon>
				</Button.Tooltip>
				<Button.Tooltip content="Redo" shortcut="Shift-Mod-z">
					<Button.Icon
						label="Redo"
						disabled={!undoState.canRedo}
						onMouseDown={keepCaret}
						onClick={() => editor.undoManager.redo()}
					>
						<Icon.Redo />
					</Button.Icon>
				</Button.Tooltip>
				<Button.Tooltip content={collaborationLabel}>
					<Button.Icon
						label={collaborationLabel}
						enabled={collaborationLive}
						onClick={onOpenCollaborate}
					>
						<Icon.Collaborate />
					</Button.Icon>
				</Button.Tooltip>
				<Button.Tooltip content="Document state">
					<Button.Icon
						label="Document state"
						active={inspectorOpen}
						onClick={onToggleInspector}
					>
						<Icon.SidebarRight open={inspectorOpen} />
					</Button.Icon>
				</Button.Tooltip>
			</div>
		</header>
	);
}

/**
 * The block-type control. Pen's `Toolbar.Select` is a native `<select>`; this
 * uses the playground `Select` and writes through `convertBlock`.
 */
function BlockTypeSelect() {
	const { editor, state } = useToolbarContext();
	const selectedValue = state.blockTypeOptions.some(
		(option) => option.value === state.blockType,
	)
		? (state.blockType ?? "")
		: "";

	return (
		<Select
			label="Block type"
			value={selectedValue}
			options={state.blockTypeOptions}
			disabled={!selectedValue}
			onChange={(value) => applyBlockType(editor, value)}
		/>
	);
}

function applyBlockType(editor: Editor, newType: string) {
	const blockId = selectedBlockId(editor);
	if (blockId) {
		getCommandRegistry(editor)?.dispatch(convertBlock, {
			blockId,
			newType,
		});
	}
}

/** The block a type change applies to: the caret's, or the first selected. */
function selectedBlockId(editor: Editor): string | null {
	const selection = editor.selection;
	if (selection?.type === "text") {
		return selection.anchor.blockId;
	}
	if (selection?.type === "block") {
		return selection.blockIds[0] ?? null;
	}
	return null;
}

/**
 * `asChild` hands the primitive's behaviour to our own button, so the toggle
 * gets `data-active` and the click handler while keeping the shared styles.
 */
function MarkToggle({
	format,
	label,
	shortcut,
	children,
}: {
	format: string;
	label: string;
	shortcut?: string;
	children: ReactNode;
}) {
	return (
		<Button.Tooltip content={label} shortcut={shortcut}>
			<Pen.Toolbar.Toggle format={format} asChild>
				<Button
					aria-label={label}
					kind="transparent"
					size="sm"
					square
					onMouseDown={keepCaret}
				>
					{children}
				</Button>
			</Pen.Toolbar.Toggle>
		</Button.Tooltip>
	);
}
