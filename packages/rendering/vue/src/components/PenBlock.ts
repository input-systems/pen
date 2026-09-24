import {
	resolveBlockDirection,
	resolveEditorMessage,
	resolveSchemaA11y,
} from "@input/pen-core";
import {
	resolveBlockTextAlignment,
	resolveEditorUrl,
} from "@input/pen-dom";
import {
	buildDataAttributes,
	DATA_ATTRS,
} from "@input/pen-dom/utils/dataAttributes";
import { isCellInSelection } from "@input/pen-dom/utils/cellSelection";
import type { BlockHandle, CellSelection } from "@input/pen-types";
import {
	defineComponent,
	h,
	onMounted,
	onUpdated,
	ref,
	type ComponentPublicInstance,
	type VNode,
	type VNodeChild,
} from "vue";
import { useSelection } from "../composables/useSelection";
import {
	isBlockSelected,
	resolveExpandedSurfaceRole,
	resolveNumberedListValue,
	useBlockModel,
	useChildBlockIds,
	useFieldEditorState,
} from "../internal/editorState";
import { useEditorContext } from "../internal/editorContext";
import { useFieldEditorContext } from "../internal/fieldEditorContext";
import type { PenBlockRenderContext } from "../types";
import { PenInlineContent } from "./PenInlineContent";
import { PenTableCellContent } from "./PenTableCellContent";

const TOGGLE_TRIGGER_MIN_SIZE_PX = 24;

/**
 * Renders one block by id, dispatching to the matching entry in the
 * `renderers` override map and falling back to the built-in rendering
 * for the block's schema type. Handles selection and direction
 * attributes, nested children, and table cells.
 */
export const PenBlock = defineComponent({
	name: "PenBlock",
	props: {
		blockId: {
			type: String,
			required: true,
		},
	},
	setup(props) {
		const { editor, readonly, renderers } = useEditorContext();
		const fieldEditor = useFieldEditorContext();
		const selection = useSelection(editor);
		const fieldEditorState = useFieldEditorState(fieldEditor);
		const blockModel = useBlockModel(editor, props.blockId);
		const childBlockIds = useChildBlockIds(editor, props.blockId);
		const blockElement = ref<HTMLElement | null>(null);

		const ackMounted = () => {
			const element = blockElement.value;
			if (!element || !fieldEditor) {
				return;
			}
			fieldEditor.ackBlockMounted(props.blockId, element);
		};
		onMounted(ackMounted);
		onUpdated(ackMounted);

		return (): VNode | null => {
			if (!blockModel.value.exists) {
				return null;
			}

			const block = editor.getBlock(props.blockId);
			if (!block) {
				return null;
			}

			const isSelected = isBlockSelected(
				editor,
				selection.value,
				props.blockId,
			);
			const isFocused =
				fieldEditorState.value.focusBlockId === props.blockId;
			const surfaceRole = resolveExpandedSurfaceRole(
				editor,
				fieldEditorState.value,
				props.blockId,
			);
			const childNodes: VNode[] = childBlockIds.value.map(
				(childBlockId) =>
					h(PenBlock, {
						key: childBlockId,
						blockId: childBlockId,
					}),
			);
			const renderInlineContent: PenBlockRenderContext["renderInlineContent"] =
				(options) =>
					h(PenInlineContent, {
						blockId: block.id,
						...(options?.as ? { as: options.as } : {}),
						...(options?.placeholder
							? { placeholder: options.placeholder }
							: {}),
					});
			const overrideRenderer = renderers.value?.[block.type];
			const blockBody: VNodeChild = overrideRenderer
				? overrideRenderer(block, {
						readonly: readonly.value,
						selected: isSelected,
						focused: isFocused,
						childNodes,
						renderInlineContent,
					})
				: renderBlockBody({
						block,
						readonly: readonly.value,
						childNodes,
						toggleFieldEditor: fieldEditor,
						editor,
						selection: selection.value,
						renderInlineContent,
					});

			return h(
				"div",
				{
					ref: (
						element: Element | ComponentPublicInstance | null,
					) => {
						blockElement.value =
							element instanceof HTMLElement ? element : null;
					},
					[DATA_ATTRS.editorBlock]: "",
					[DATA_ATTRS.blockId]: props.blockId,
					[DATA_ATTRS.blockType]: block.type,
					...buildDataAttributes({
						selected: isSelected,
						focused: isFocused,
					}),
					[DATA_ATTRS.surfaceRole]: surfaceRole ?? undefined,
					dir: resolvedContentDir(editor, block),
					style: {
						unicodeBidi: "isolate",
						textAlign: resolveBlockTextAlignment(block),
					},
					tabIndex: -1,
					contentEditable:
						surfaceRole != null && surfaceRole !== "editable-inline"
							? false
							: undefined,
				},
				[blockBody],
			);
		};
	},
});

function renderBlockBody(args: {
	block: BlockHandle;
	readonly: boolean;
	childNodes: PenBlockRenderContext["childNodes"];
	toggleFieldEditor: ReturnType<typeof useFieldEditorContext>;
	editor: ReturnType<typeof useEditorContext>["editor"];
	selection: ReturnType<typeof useSelection>["value"];
	renderInlineContent: PenBlockRenderContext["renderInlineContent"];
}) {
	const {
		block,
		readonly,
		childNodes,
		toggleFieldEditor,
		editor,
		selection,
		renderInlineContent,
	} = args;

	switch (block.type) {
		case "paragraph":
			return h("div", { "data-block-type": "paragraph" }, [
				renderInlineContent(),
			]);
		case "heading": {
			const level = clampHeadingLevel(block.props.level);
			return h(
				`h${level}`,
				{ "data-block-type": "heading", "data-level": level },
				[renderInlineContent()],
			);
		}
		case "bulletListItem": {
			const indent = resolveIndent(block);
			return h(
				"div",
				{
					"data-block-type": "bulletListItem",
					style: { marginLeft: `${indent * 24}px` },
				},
				[
					h(
						"span",
						{
							"data-pen-list-marker": "",
							// Justified decorative list marker
							"aria-hidden": "true",
						},
						"-",
					),
					renderInlineContent(),
				],
			);
		}
		case "numberedListItem": {
			const indent = resolveIndent(block);
			const value = resolveNumberedListValue(editor, block.id);
			return h(
				"div",
				{
					"data-block-type": "numberedListItem",
					"data-counter": value,
					style: { marginLeft: `${indent * 24}px` },
				},
				[
					h(
						"span",
						{
							"data-pen-list-marker": "",
							// Justified decorative list marker
							"aria-hidden": "true",
						},
						`${value}.`,
					),
					renderInlineContent(),
				],
			);
		}
		case "checkListItem": {
			const indent = resolveIndent(block);
			const checked = Boolean(block.props.checked);

			return h(
				"div",
				{
					"data-block-type": "checkListItem",
					"data-checked": checked ? "" : undefined,
					style: { marginLeft: `${indent * 24}px` },
				},
				[
					h("input", {
						type: "checkbox",
						checked,
						disabled: readonly,
						"aria-label": resolveEditorMessage(
							editor,
							"pen.checklist.toggle",
						),
						onChange: () => {
							if (readonly) {
								return;
							}
							editor.apply(
								[
									{
										type: "set-props",
										blockId: block.id,
										props: { checked: !checked },
									},
								],
								{ origin: "user" },
							);
						},
					}),
					renderInlineContent(),
				],
			);
		}
		case "callout": {
			const calloutType = (block.props.severity as string) ?? "info";
			const icon =
				calloutType === "warning"
					? "!"
					: calloutType === "error"
						? "x"
						: "i";
			const childContainer =
				childNodes.length > 0
					? h("div", { "data-pen-callout-children": "" }, childNodes)
					: null;

			return h(
				"div",
				{
					"data-block-type": "callout",
					"data-callout-type": calloutType,
					role: "note",
				},
				[
					h(
						"span",
						{
							"data-pen-callout-icon": "",
							// Justified decorative callout icon
							"aria-hidden": "true",
						},
						icon,
					),
					h("div", { "data-pen-callout-body": "" }, [
						renderInlineContent(),
						childContainer,
					]),
				],
			);
		}
		case "toggle": {
			const open = Boolean(block.props.open);
			const childContainer =
				open && childNodes.length > 0
					? h("div", { "data-pen-toggle-body": "" }, childNodes)
					: null;

			return h("div", { "data-block-type": "toggle" }, [
				h("div", { "data-pen-toggle-header": "" }, [
					h(
						"button",
						{
							type: "button",
							"data-pen-toggle-trigger": "",
							"data-pen-ignore-pointer-gesture": "",
							style: {
								minWidth: `${TOGGLE_TRIGGER_MIN_SIZE_PX}px`,
								minHeight: `${TOGGLE_TRIGGER_MIN_SIZE_PX}px`,
							},
							"aria-expanded": open,
							onMousedown: (event: MouseEvent) => {
								event.preventDefault();
								event.stopPropagation();
								toggleFieldEditor?.blur();
							},
							onClick: (event: MouseEvent) => {
								event.preventDefault();
								event.stopPropagation();
								if (readonly) {
									return;
								}
								editor.apply(
									[
										{
											type: "set-props",
											blockId: block.id,
											props: { open: !open },
										},
									],
									{ origin: "user" },
								);
							},
						},
						open ? "v" : ">",
					),
					h("div", { "data-pen-toggle-title": "" }, [
						renderInlineContent(),
					]),
				]),
				childContainer,
			]);
		}
		case "blockquote": {
			const childContainer =
				childNodes.length > 0
					? h(
							"div",
							{ "data-pen-blockquote-children": "" },
							childNodes,
						)
					: null;

			return h("blockquote", { "data-block-type": "blockquote" }, [
				renderInlineContent(),
				childContainer,
			]);
		}
		case "divider":
			return h("hr", { "data-block-type": "divider" });
		case "codeBlock": {
			const language =
				(block.props.language as string | undefined) ?? undefined;
			return h(
				"pre",
				{
					"data-block-type": "codeBlock",
					"data-language": language,
				},
				[
					h(
						"code",
						{
							class: language
								? `language-${language}`
								: undefined,
						},
						[renderInlineContent()],
					),
				],
			);
		}
		case "image": {
			const src = resolveEditorUrl(editor, block.props.src, "image");
			const caption =
				typeof block.props.caption === "string"
					? block.props.caption
					: "";
			const width =
				typeof block.props.width === "number"
					? block.props.width
					: undefined;

			const imageA11y = resolveSchemaA11y(editor, {
				kind: "block",
				type: block.type,
				props: { ...block.props },
			});
			return h("figure", { "data-block-type": "image" }, [
				h("img", {
					src: src ?? undefined,
					alt: imageA11y.label,
					"aria-roledescription": imageA11y.roleDescription,
					"data-pen-blocked-url": src == null ? "" : undefined,
					style: width ? { width: `${width}px` } : undefined,
				}),
				caption ? h("figcaption", {}, caption) : null,
			]);
		}
		case "table":
			return renderTable(
				block,
				editor,
				readonly,
				toggleFieldEditor,
				selection,
			);
		default:
			return h(
				"div",
				{
					"data-block-type": block.type,
					"data-unknown-block": "",
					"data-selected": isBlockSelected(editor, selection, block.id)
						? ""
						: undefined,
					contentEditable: false,
				},
				[h("span", { "data-pen-unknown-type": "" }, block.type)],
			);
	}
}

function renderTable(
	block: BlockHandle,
	editor: ReturnType<typeof useEditorContext>["editor"],
	readonly: boolean,
	fieldEditor: ReturnType<typeof useFieldEditorContext>,
	selection: ReturnType<typeof useSelection>["value"],
) {
	const table = block.as("table");
	const rowCount = table?.tableRowCount() ?? 0;
	const columnCount = table?.tableColumnCount() ?? 0;
	const hasHeaderRow = Boolean(block.props.hasHeaderRow);
	const cellSelection =
		selection?.type === "cell" && selection.blockId === block.id
			? selection
			: null;

	const bodyRows: VNode[] = [];
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
		const isHeaderRow = hasHeaderRow && rowIndex === 0;
		const cellNodes: VNode[] = [];

		for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
			const cellTag = isHeaderRow ? "th" : "td";
			const isSelectedCell =
				cellSelection != null &&
				isCellInSelection(cellSelection, rowIndex, columnIndex);
			const placeholder = isHeaderRow
				? resolveEditorMessage(editor, "pen.table.columnPlaceholder", {
						index: columnIndex + 1,
					})
				: undefined;

			cellNodes.push(
				h(
					cellTag,
					{
						key: `${rowIndex}:${columnIndex}`,
						...(isHeaderRow ? { scope: "col" } : {}),
						[DATA_ATTRS.tableCell]: "",
						[DATA_ATTRS.tableCellRow]: rowIndex,
						[DATA_ATTRS.tableCellCol]: columnIndex,
						"data-pen-cell-selected": isSelectedCell
							? ""
							: undefined,
						onMousedown: (event: MouseEvent) => {
							if (readonly || !fieldEditor) {
								return;
							}

							if (
								fieldEditor.activeCellCoord?.blockId ===
									block.id &&
								fieldEditor.activeCellCoord.row === rowIndex &&
								fieldEditor.activeCellCoord.col === columnIndex
							) {
								return;
							}

							event.preventDefault();
							event.stopPropagation();
							editor.selectCell(block.id, rowIndex, columnIndex);
						},
						onDblclick: (event: MouseEvent) => {
							if (readonly || !fieldEditor) {
								return;
							}

							event.preventDefault();
							event.stopPropagation();

							const currentTarget = event.currentTarget;
							const cellElement =
								currentTarget instanceof HTMLElement
									? (currentTarget.querySelector(
											`[${DATA_ATTRS.fieldEditorSurface}]`,
										) as HTMLElement | null)
									: null;

							if (
								cellElement &&
								typeof fieldEditor.activateCellFromElement ===
									"function"
							) {
								fieldEditor.activateCellFromElement(
									block.id,
									rowIndex,
									columnIndex,
									cellElement,
								);
								return;
							}

							fieldEditor.activateCell?.(
								block.id,
								rowIndex,
								columnIndex,
							);
						},
					},
					[
						h(PenTableCellContent, {
							tableBlockId: block.id,
							row: rowIndex,
							col: columnIndex,
							placeholder,
						}),
					],
				),
			);
		}

		bodyRows.push(
			h(
				"tr",
				{ key: `row:${rowIndex}`, "data-pen-table-row": "" },
				cellNodes,
			),
		);
	}

	const headerRows = hasHeaderRow && bodyRows.length > 0 ? [bodyRows[0]] : [];
	const dataRows = hasHeaderRow ? bodyRows.slice(1) : bodyRows;
	const tableChildren = [];

	if (headerRows.length > 0) {
		tableChildren.push(h("thead", {}, headerRows));
	}
	tableChildren.push(h("tbody", {}, dataRows));

	return h("div", { "data-block-type": "table" }, [
		h("div", { [DATA_ATTRS.tableFrame]: "" }, [
			h("table", { [DATA_ATTRS.table]: "" }, tableChildren),
		]),
	]);
}

function resolvedContentDir(
	editor: ReturnType<typeof useEditorContext>["editor"],
	block: BlockHandle,
): "ltr" | "rtl" | undefined {
	const resolved = resolveBlockDirection(editor, block);
	if (block.props.direction === "ltr" || block.props.direction === "rtl") {
		return resolved;
	}
	return resolved === "rtl" ? "rtl" : undefined;
}

function resolveIndent(block: BlockHandle): number {
	return typeof block.props.indent === "number" ? block.props.indent : 0;
}

function clampHeadingLevel(level: unknown): number {
	if (typeof level !== "number") {
		return 1;
	}
	return Math.max(1, Math.min(6, level));
}
