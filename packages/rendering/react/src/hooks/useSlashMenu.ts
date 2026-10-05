import { useState, useRef, useEffect } from "react";
import {
	foldAndNormalize,
	isCollapsed,
	localeFacet,
	orderSlashMenuItemsByGroup,
} from "@input/pen-core";
import type {
	BlockDisplay,
	BlockSchema,
	DocumentOp,
	Editor,
} from "@input/pen-types";
import { generateId } from "@input/pen-types";
import {
	displayCatalogForEditor,
	resolveSlashMenuTitle,
} from "../utils/displayCopy";
import { getAttachedFieldEditor } from "../utils/fieldEditor";
import { getConvertBlockOps } from "@input/pen-dom/field-editor/commands";
import { getInsertSiblingBlockOp } from "../utils/parentIdTree";
import { shouldShowBlockInDefaultMenus } from "../utils/flowCapabilities";
import {
	getStarterTableProps,
	getTableActivationTarget,
	createDefaultTableColumns,
} from "../utils/tableDefaults";

export interface SlashMenuState {
	open: boolean;
	query: string;
	items: Array<{ type: string; display: BlockDisplay }>;
	selectedIndex: number;
	target?: SlashMenuTarget | null;
}

export interface SlashMenuTarget {
	blockId: string;
	startOffset: number;
	endOffset: number;
	query: string;
}

export interface SlashMenuActions {
	setQuery: (q: string) => void;
	select: (index: number) => void;
	confirm: (index?: number) => boolean;
	dismiss: () => void;
}

export function useSlashMenu(
	editor: Editor,
): SlashMenuState & SlashMenuActions {
	const [state, setState] = useState<SlashMenuState>({
		open: false,
		query: "",
		items: [],
		selectedIndex: 0,
		target: null,
	});
	const editorRef = useRef(editor);
	editorRef.current = editor;

	const allDisplays = editor.schema.allBlockDisplays();
	const allDisplaysRef = useRef(allDisplays);
	allDisplaysRef.current = allDisplays;

	useEffect(() => {
		const syncSlashMenu = () => {
			const target = getSlashTarget(editorRef.current);
			if (!target) {
				setState((prev) =>
					prev.open
						? {
								open: false,
								query: "",
								items: [],
								selectedIndex: 0,
								target: null,
							}
						: prev,
				);
				return;
			}

			const items = filterItems(
				allDisplaysRef.current,
				target.query,
				editorRef.current,
			);
			setState((prev) => ({
				open: true,
				query: target.query,
				items,
				selectedIndex:
					items.length === 0
						? 0
						: Math.min(prev.selectedIndex, items.length - 1),
				target,
			}));
		};

		syncSlashMenu();
		const unsubDocument = editor.on("commit", () => syncSlashMenu());
		const unsubSelection = editor.onSelectionChange(syncSlashMenu);
		return () => {
			unsubDocument();
			unsubSelection();
		};
	}, [editor]);

	const setQuery = (query: string) => {
		const filtered = filterItems(allDisplays, query, editor);
		setState((prev) => ({
			...prev,
			query,
			items: filtered,
			selectedIndex: 0,
			target: prev.target
				? {
						...prev.target,
						query,
						endOffset: prev.target.startOffset + 1 + query.length,
					}
				: prev.target,
		}));
	};

	const select = (index: number) => {
		setState((prev) => ({
			...prev,
			selectedIndex: Math.max(0, Math.min(index, prev.items.length - 1)),
		}));
	};

	const confirm = (index?: number): boolean => {
		const itemIndex = index ?? state.selectedIndex;
		const item = state.items[itemIndex];
		if (!item) return false;

		const ed = editorRef.current;
		const selection = ed.selection;

		if (selection?.type === "text") {
			const blockId = selection.anchor.blockId;
			const block = ed.getBlock(blockId);
			let insertedOrConvertedBlockId: string | null = null;

			if (block) {
				const trigger = getSlashTarget(ed);
				const triggerRange =
					trigger && trigger.blockId === blockId ? trigger : null;
				// the trigger is menu state that happens to live in the
				// document, so it never survives confirm; what is left over
				// decides whether the block is replaced or kept. Measured in
				// the logical domain the splice uses, where an inline atom
				// inside the query counts as one.
				const triggerLength = triggerRange
					? triggerRange.endOffset - triggerRange.startOffset
					: 0;
				const lengthOutsideTrigger = block.length() - triggerLength;
				const isTableInsert = item.type === "table";
				const tableActivationTarget = isTableInsert
					? getTableActivationTarget(undefined)
					: null;
				const tableProps = isTableInsert
					? getStarterTableProps()
					: undefined;

				const ops: DocumentOp[] = [];
				if (triggerRange && triggerLength > 0) {
					ops.push({
						type: "splice-text",
						blockId,
						from: triggerRange.startOffset,
						to: triggerRange.endOffset,
						insert: "",
					});
				}

				if (lengthOutsideTrigger === 0) {
					if (block.type !== item.type) {
						ops.push(
							...getConvertBlockOps(ed, {
								blockId,
								newType: item.type,
								newProps: tableProps,
							}),
						);
					}
					insertedOrConvertedBlockId = blockId;
				} else {
					const newBlockId = generateId();
					ops.push(
						getInsertSiblingBlockOp(ed, {
							siblingBlockId: blockId,
							blockId: newBlockId,
							blockType: item.type,
							props: tableProps ?? {},
						}),
					);
					insertedOrConvertedBlockId = newBlockId;
				}

				if (ops.length > 0) {
					ed.apply(ops, { origin: "user", undoGroup: true });
				}

				if (
					isTableInsert &&
					insertedOrConvertedBlockId &&
					tableActivationTarget
				) {
					const defaultCols = createDefaultTableColumns(2);
					ed.apply(
						[
							{
								type: "set-props",
								blockId: insertedOrConvertedBlockId,
								props: { columns: defaultCols },
							},
						],
						{ origin: "user", undoGroup: true },
					);
					// W3.R8: activate in this turn; the table's mount ack
					// attaches the cell once it renders (P4).
					const fieldEditor = getAttachedFieldEditor(ed);
					fieldEditor?.activateCell?.(
						insertedOrConvertedBlockId!,
						tableActivationTarget.row,
						tableActivationTarget.col,
					);
				}
			}
		}

		setState(getClosedSlashMenuState());
		return true;
	};

	const dismiss = () => {
		setState(getClosedSlashMenuState());
	};

	return { ...state, setQuery, select, confirm, dismiss };
}

function getSlashTarget(editor: Editor): SlashMenuTarget | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text" || !isCollapsed(selection)) {
		return null;
	}

	if (selection.anchor.blockId !== selection.focus.blockId) {
		return null;
	}

	const block = editor.getBlock(selection.anchor.blockId);
	const text = block?.textContent() ?? "";
	if (!text.startsWith("/")) {
		return null;
	}

	return {
		blockId: selection.anchor.blockId,
		startOffset: 0,
		endOffset: selection.focus.offset,
		query: text.slice(1, selection.focus.offset),
	};
}

function getClosedSlashMenuState(): SlashMenuState {
	return {
		open: false,
		query: "",
		items: [],
		selectedIndex: 0,
		target: null,
	};
}

function filterItems(
	displays: readonly (BlockSchema & {
		display: BlockDisplay;
	})[],
	query: string,
	editor: Editor,
): Array<{ type: string; display: BlockDisplay }> {
	const visibleDisplays = displays.filter((display) =>
		shouldShowBlockInDefaultMenus(editor.documentProfile, display),
	);

	if (!query) {
		return orderSlashMenuItemsByGroup(
			visibleDisplays.map((d) => ({
				type: d.type,
				display: d.display,
			})),
		);
	}

	const locale = editor.facet(localeFacet);
	const catalog = displayCatalogForEditor(editor);
	const foldedQuery = foldAndNormalize(query, locale);
	const matches = visibleDisplays
		.filter((d) => {
			const title = foldAndNormalize(
				resolveSlashMenuTitle(d.type, d.display.title, catalog),
				locale,
			);
			const desc = foldAndNormalize(d.display.description ?? "", locale);
			const aliases = d.display.aliases ?? [];
			return (
				title.includes(foldedQuery) ||
				desc.includes(foldedQuery) ||
				aliases.some((alias) =>
					foldAndNormalize(alias, locale).includes(foldedQuery),
				)
			);
		})
		.sort((a: (typeof displays)[number], b: (typeof displays)[number]) => {
			const aPos = foldAndNormalize(
				resolveSlashMenuTitle(a.type, a.display.title, catalog),
				locale,
			).indexOf(foldedQuery);
			const bPos = foldAndNormalize(
				resolveSlashMenuTitle(b.type, b.display.title, catalog),
				locale,
			).indexOf(foldedQuery);
			return aPos - bPos;
		})
		.map((d) => ({ type: d.type, display: d.display }));

	// grouping after the relevance sort keeps the closest match at index 0,
	// because its group is the first group to appear.
	return orderSlashMenuItemsByGroup(matches);
}
