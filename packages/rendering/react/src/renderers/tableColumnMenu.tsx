import React, { useState, useRef, useEffect } from "react";
import { resolveEditorMessage } from "@input/pen-core";
import type { Editor, TableColumnSchema } from "@input/pen-types";
import { generateId } from "@input/pen-types";
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import {
	captureFocusReturn,
	restoreFocusReturn,
	type FocusReturnPreference,
} from "@input/pen-dom";
import { resolveChromeEditorRoot } from "../utils/aiDomScope";
import { getAttachedFieldEditorSession } from "../utils/fieldEditor";

type MenuColumnType =
	| "text"
	| "number"
	| "select"
	| "checkbox"
	| "date"
	| "url"
	| "email";

const COLUMN_TYPES: { value: MenuColumnType; icon: string }[] = [
	{ value: "text", icon: "Aa" },
	{ value: "number", icon: "#" },
	{ value: "select", icon: "▾" },
	{ value: "checkbox", icon: "☑" },
	{ value: "date", icon: "📅" },
	{ value: "url", icon: "🔗" },
	{ value: "email", icon: "@" },
];

const ROVING_ITEM_SELECTOR = "[data-pen-column-menu-item]";
const TITLE_ROVING_INDEX = 0;
const TYPE_ROVING_START = 1;
const INSERT_LEFT_ROVING_INDEX = TYPE_ROVING_START + COLUMN_TYPES.length;
const INSERT_RIGHT_ROVING_INDEX = INSERT_LEFT_ROVING_INDEX + 1;
const DELETE_ROVING_INDEX = INSERT_RIGHT_ROVING_INDEX + 1;

export interface ColumnHeaderMenuProps {
	editor: Editor;
	blockId: string;
	column: TableColumnSchema;
	columnIndex: number;
	allColumns: readonly TableColumnSchema[];
	colCount: number;
	anchorEl: HTMLElement;
	anchorRect: {
		top: number;
		left: number;
		bottom: number;
		right: number;
		width: number;
		height: number;
	};
	onClose: () => void;
}

function getRovingItems(menu: HTMLElement): HTMLElement[] {
	return Array.from(menu.querySelectorAll<HTMLElement>(ROVING_ITEM_SELECTOR));
}

function rovingTabIndex(activeIndex: number, itemIndex: number): number {
	return activeIndex === itemIndex ? 0 : -1;
}

/**
 * AX3 detached surface: `role="menu"`, roving tabindex, arrow keys move within.
 * Escape and every action close it and return focus to the invoking column
 * header control (D15); delete removes that control, so focus goes to the
 * editor surface. An outside mousedown returns nothing: the pointer chose
 * the next target. Does not steal editor focus on open.
 */
export function ColumnHeaderMenu(props: ColumnHeaderMenuProps) {
	const {
		editor,
		blockId,
		column,
		columnIndex,
		allColumns,
		colCount,
		anchorEl,
		anchorRect,
		onClose,
	} = props;
	const menuRef = useRef<HTMLDivElement>(null);
	const [title, setTitle] = useState(column.title);
	const [activeIndex, setActiveIndex] = useState(TITLE_ROVING_INDEX);

	function updateColumns(updated: TableColumnSchema[]) {
		editor.apply(
			[{ type: "set-props", blockId, props: { columns: updated } }],
			{ origin: "user" },
		);
	}

	function commitTitle() {
		const trimmed = title.trim();
		if (!trimmed || trimmed === column.title) return;
		const updated = allColumns.map((c, i) =>
			i === columnIndex ? { ...c, title: trimmed } : c,
		);
		updateColumns([...updated]);
	}

	function closeAndReturnFocus(prefer: FocusReturnPreference = "target") {
		onClose();
		const root = resolveChromeEditorRoot(editor, anchorEl);
		if (!root) return;
		restoreFocusReturn(
			captureFocusReturn(root, anchorEl),
			getAttachedFieldEditorSession(editor),
			prefer,
			{ owner: menuRef.current },
		);
	}

	function handleRovingFocus(event: React.FocusEvent<HTMLElement>) {
		const menu = menuRef.current;
		if (!menu) return;
		const index = getRovingItems(menu).indexOf(event.currentTarget);
		if (index >= 0) setActiveIndex(index);
	}

	function moveRovingFocus(key: "ArrowDown" | "ArrowUp" | "Home" | "End") {
		const menu = menuRef.current;
		if (!menu) return;
		const items = getRovingItems(menu);
		if (items.length === 0) return;

		const focusedIndex = items.indexOf(
			document.activeElement as HTMLElement,
		);
		const from = focusedIndex >= 0 ? focusedIndex : activeIndex;
		let next = from;
		switch (key) {
			case "ArrowDown":
				next = (from + 1) % items.length;
				break;
			case "ArrowUp":
				next = (from - 1 + items.length) % items.length;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = items.length - 1;
				break;
			default: {
				const _exhaustive: never = key;
				return _exhaustive;
			}
		}
		items[next]?.focus();
	}

	function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			setTitle(column.title);
			closeAndReturnFocus();
			return;
		}

		const target = event.target;
		if (
			event.key === "Enter" &&
			target instanceof HTMLInputElement &&
			target.dataset.penColumnMenuItem !== undefined
		) {
			event.preventDefault();
			commitTitle();
			closeAndReturnFocus();
			return;
		}

		if (
			event.key === "ArrowDown" ||
			event.key === "ArrowUp" ||
			event.key === "Home" ||
			event.key === "End"
		) {
			event.preventDefault();
			event.stopPropagation();
			moveRovingFocus(event.key);
		}
	}

	function handleTypeChange(newType: TableColumnSchema["type"]) {
		const updated = allColumns.map((c, i) =>
			i === columnIndex ? { ...c, type: newType } : c,
		);
		updateColumns([...updated]);
		closeAndReturnFocus();
	}

	function handleInsertLeft() {
		const newCol: TableColumnSchema = {
			id: generateId(),
			title: `Column ${colCount + 1}`,
			type: "text",
		};
		const updated = [...allColumns];
		updated.splice(columnIndex, 0, newCol);
		editor.apply(
			[
				{ type: "set-props", blockId, props: { columns: updated } },
				{
					type: "grid",
					blockId,
					change: { kind: "insert-column", index: columnIndex },
				},
			],
			{ origin: "user" },
		);
		closeAndReturnFocus();
	}

	function handleInsertRight() {
		const newCol: TableColumnSchema = {
			id: generateId(),
			title: `Column ${colCount + 1}`,
			type: "text",
		};
		const updated = [...allColumns];
		updated.splice(columnIndex + 1, 0, newCol);
		editor.apply(
			[
				{ type: "set-props", blockId, props: { columns: updated } },
				{
					type: "grid",
					blockId,
					change: { kind: "insert-column", index: columnIndex + 1 },
				},
			],
			{ origin: "user" },
		);
		closeAndReturnFocus();
	}

	function handleDelete() {
		if (colCount <= 1) return;
		const updated = allColumns.filter((_, i) => i !== columnIndex);
		editor.apply(
			[
				{
					type: "set-props",
					blockId,
					props: { columns: [...updated] },
				},
				{
					type: "grid",
					blockId,
					change: { kind: "delete-column", index: columnIndex },
				},
			],
			{ origin: "user" },
		);
		// The invoking header goes with its column.
		closeAndReturnFocus("surface");
	}

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(e.target as Node) &&
				!anchorEl.contains(e.target as Node)
			) {
				commitTitle();
				onClose();
			}
		};
		// `pointerdown`, not `mousedown`: a control that cancels its
		// pointerdown suppresses the compatibility mouse events.
		document.addEventListener("pointerdown", handler);
		return () => document.removeEventListener("pointerdown", handler);
	}, [anchorEl, onClose, title]);

	useIsomorphicLayoutEffect(() => {
		if (!menuRef.current) return;
		menuRef.current.style.top = `${anchorRect.bottom + 4}px`;
		menuRef.current.style.left = `${anchorRect.left}px`;
	}, [anchorRect.bottom, anchorRect.left]);

	const typeItems = COLUMN_TYPES.map((ct, typeIndex) => (
		<button
			key={ct.value}
			type="button"
			role="menuitem"
			tabIndex={rovingTabIndex(
				activeIndex,
				TYPE_ROVING_START + typeIndex,
			)}
			data-pen-column-menu-item=""
			className="pen-col-menu-item"
			data-active={ct.value === column.type ? "" : undefined}
			onFocus={handleRovingFocus}
			onClick={() => handleTypeChange(ct.value)}
		>
			<span className="pen-col-menu-icon">{ct.icon}</span>
			{columnTypeLabel(editor, ct.value)}
		</button>
	));

	return (
		<div
			ref={menuRef}
			role="menu"
			aria-label={resolveEditorMessage(
				editor,
				"pen.table.columnMenu.label",
				{
					title: column.title,
				},
			)}
			aria-orientation="vertical"
			className="pen-col-menu"
			data-pen-column-menu=""
			onKeyDown={handleMenuKeyDown}
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
		>
			<div className="pen-col-menu-title-row">
				<input
					className="pen-col-menu-title-input"
					type="text"
					value={title}
					tabIndex={rovingTabIndex(activeIndex, TITLE_ROVING_INDEX)}
					data-pen-column-menu-item=""
					onChange={(e) => setTitle(e.target.value)}
					onFocus={handleRovingFocus}
					onBlur={commitTitle}
					spellCheck={false}
				/>
			</div>
			<div className="pen-col-menu-divider" />
			<div className="pen-col-menu-section">
				{resolveEditorMessage(editor, "pen.table.columnMenu.type")}
			</div>
			{typeItems}
			<div className="pen-col-menu-divider" />
			<button
				type="button"
				role="menuitem"
				tabIndex={rovingTabIndex(activeIndex, INSERT_LEFT_ROVING_INDEX)}
				data-pen-column-menu-item=""
				className="pen-col-menu-item"
				onFocus={handleRovingFocus}
				onClick={handleInsertLeft}
			>
				{resolveEditorMessage(
					editor,
					"pen.table.columnMenu.insertLeft",
				)}
			</button>
			<button
				type="button"
				role="menuitem"
				tabIndex={rovingTabIndex(
					activeIndex,
					INSERT_RIGHT_ROVING_INDEX,
				)}
				data-pen-column-menu-item=""
				className="pen-col-menu-item"
				onFocus={handleRovingFocus}
				onClick={handleInsertRight}
			>
				{resolveEditorMessage(
					editor,
					"pen.table.columnMenu.insertRight",
				)}
			</button>
			{colCount > 1 && (
				<>
					<div className="pen-col-menu-divider" />
					<button
						type="button"
						role="menuitem"
						tabIndex={rovingTabIndex(
							activeIndex,
							DELETE_ROVING_INDEX,
						)}
						data-pen-column-menu-item=""
						className="pen-col-menu-item pen-col-menu-danger"
						onFocus={handleRovingFocus}
						onClick={handleDelete}
					>
						{resolveEditorMessage(
							editor,
							"pen.table.columnMenu.delete",
						)}
					</button>
				</>
			)}
		</div>
	);
}

function columnTypeLabel(editor: Editor, type: MenuColumnType): string {
	switch (type) {
		case "text":
			return resolveEditorMessage(editor, "pen.table.columnType.text");
		case "number":
			return resolveEditorMessage(editor, "pen.table.columnType.number");
		case "select":
			return resolveEditorMessage(editor, "pen.table.columnType.select");
		case "checkbox":
			return resolveEditorMessage(
				editor,
				"pen.table.columnType.checkbox",
			);
		case "date":
			return resolveEditorMessage(editor, "pen.table.columnType.date");
		case "url":
			return resolveEditorMessage(editor, "pen.table.columnType.url");
		case "email":
			return resolveEditorMessage(editor, "pen.table.columnType.email");
		default: {
			const exhaustive: never = type;
			return exhaustive;
		}
	}
}
