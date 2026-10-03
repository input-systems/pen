import React, { useRef } from "react";
import { resolveEditorMessage } from "@input/pen-core";
import type {
	BlockHandle,
	BlockRenderContext,
	CellSelection,
} from "@input/pen-types";
import { useEditorContext } from "../context/editorContext";
import { useFieldEditorContext } from "../context/fieldEditorContext";
import { useBlockSlice } from "../hooks/useBlockNotifier";
import { useRemoteSelections } from "../hooks/useRemoteSelections";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import { isCellInSelection } from "../utils/cellSelection";
import { resolveRemoteCellPresence } from "../utils/remoteCellSelection";
import { TableCellContent } from "../primitives/editor/tableCellContent";

const TABLE_CONTROL_MIN_SIZE_PX = 24;

type CellStyle = React.CSSProperties & Record<string, string | number>;

function TableRendererInner(props: {
	block: BlockHandle;
	ctx: BlockRenderContext;
}) {
	const { block, ctx } = props;
	const { editor, readonly } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	// The table block's own slices, not the full store and selection (SCALE6).
	const activeCell = useBlockSlice(block.id, "field").activeCell;
	const cellSelection = useBlockSlice(block.id, "selection").cell;
	const remoteSelections = useRemoteSelections(editor);

	const table = block.as("table");
	const rowCount = table?.tableRowCount() ?? 0;
	const colCount = table?.tableColumnCount() ?? 0;
	const hasHeaderRow = !!block.props.hasHeaderRow;
	const addRowRef = useRef<HTMLButtonElement>(null);
	const addColumnRef = useRef<HTMLButtonElement>(null);

	const remoteCellPresence = resolveRemoteCellPresence(
		remoteSelections,
		block.id,
	);

	const isEditingThisCell = (row: number, col: number) =>
		activeCell?.row === row && activeCell.col === col;

	function handleCellMouseDown(
		event: React.MouseEvent<HTMLTableCellElement>,
		row: number,
		col: number,
	) {
		if (readonly || !fieldEditor) return;
		if (isEditingThisCell(row, col)) return;

		event.preventDefault();
		event.stopPropagation();

		if (event.shiftKey && cellSelection) {
			editor.selectCellRange(block.id, cellSelection.anchor, {
				row,
				col,
			});
			return;
		}

		editor.selectCell(block.id, row, col);
	}

	function handleCellDoubleClick(
		event: React.MouseEvent<HTMLTableCellElement>,
		row: number,
		col: number,
	) {
		if (readonly || !fieldEditor) return;

		event.preventDefault();
		event.stopPropagation();

		const cellSurface = event.currentTarget.querySelector(
			`[${DATA_ATTRS.fieldEditorSurface}]`,
		) as HTMLElement | null;
		if (cellSurface) {
			fieldEditor.activateCellFromElement?.(
				block.id,
				row,
				col,
				cellSurface,
			) ?? fieldEditor.activateCell?.(block.id, row, col);
		} else {
			fieldEditor.activateCell?.(block.id, row, col);
		}
	}

	function handleAddRow() {
		editor.apply(
			[
				{
					type: "grid",
					blockId: block.id,
					change: { kind: "insert-row", index: rowCount },
				},
			],
			{ origin: "user" },
		);
	}

	function handleAddColumn() {
		editor.apply(
			[
				{
					type: "grid",
					blockId: block.id,
					change: { kind: "insert-column", index: colCount },
				},
			],
			{ origin: "user" },
		);
	}

	function handleControlMouseDown(
		event: React.MouseEvent<HTMLButtonElement>,
	) {
		event.preventDefault();
		event.stopPropagation();
	}

	const cellAttrs = (row: number, col: number) => {
		const peer = remoteCellPresence.forCell(row, col);
		return {
			[DATA_ATTRS.tableCell]: "",
			[DATA_ATTRS.tableCellRow]: row,
			[DATA_ATTRS.tableCellCol]: col,
			"data-pen-cell-selected":
				cellSelection && isCellInSelection(cellSelection, row, col)
					? ""
					: undefined,
			// COL3: a peer's name and id are display hints, never verified.
			"data-pen-multiplayer-cell-selection": peer ? "" : undefined,
			"data-pen-multiplayer-cell-head": peer?.isHead ? "" : undefined,
			"data-multiplayer-client-id": peer
				? String(peer.clientId)
				: undefined,
			"data-user-id": peer?.user.id,
			"data-user-name": peer?.user.name,
			// A decoration cannot carry colour — SEC2 drops `style` — so the
			// multiplayer package emits none. Setting the caret overlay's
			// token as a prop is what lets a peer ring in their own colour.
			style: peer
				? ({
						"--pen-peer-color": peer.user.color ?? "currentColor",
					} as CellStyle)
				: undefined,
		};
	};

	const headerCells = hasHeaderRow
		? Array.from({ length: colCount }, (_, colIdx) => (
				<th
					key={`hdr-${colIdx}`}
					scope="col"
					{...cellAttrs(0, colIdx)}
					onMouseDown={(e) => handleCellMouseDown(e, 0, colIdx)}
					onDoubleClick={(e) => handleCellDoubleClick(e, 0, colIdx)}
				>
					<TableCellContent
						tableBlockId={block.id}
						row={0}
						col={colIdx}
						placeholder={resolveEditorMessage(
							editor,
							"pen.table.columnPlaceholder",
							{ index: colIdx + 1 },
						)}
					/>
				</th>
			))
		: null;

	const dataStartRow = hasHeaderRow ? 1 : 0;

	const bodyRows: React.ReactElement[] = [];
	for (let rowIdx = dataStartRow; rowIdx < rowCount; rowIdx++) {
		const cells: React.ReactElement[] = [];
		for (let colIdx = 0; colIdx < colCount; colIdx++) {
			cells.push(
				<td
					key={`cell-${rowIdx}-${colIdx}`}
					{...cellAttrs(rowIdx, colIdx)}
					onMouseDown={(e) => handleCellMouseDown(e, rowIdx, colIdx)}
					onDoubleClick={(e) =>
						handleCellDoubleClick(e, rowIdx, colIdx)
					}
				>
					<TableCellContent
						tableBlockId={block.id}
						row={rowIdx}
						col={colIdx}
					/>
				</td>,
			);
		}
		bodyRows.push(
			<tr key={`row-${rowIdx}`} data-pen-table-row="" data-row={rowIdx}>
				{cells}
			</tr>,
		);
	}

	const addColumnControl = readonly ? null : (
		<button
			ref={addColumnRef}
			type="button"
			className="pen-table-add-column-control"
			style={{
				minWidth: TABLE_CONTROL_MIN_SIZE_PX,
				minHeight: TABLE_CONTROL_MIN_SIZE_PX,
			}}
			aria-label={resolveEditorMessage(editor, "pen.table.addColumn")}
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			onMouseDown={handleControlMouseDown}
			onClick={handleAddColumn}
		>
			<span>+</span>
		</button>
	);

	const addRowControl = readonly ? null : (
		<button
			ref={addRowRef}
			type="button"
			className="pen-table-add-row-control"
			style={{
				minWidth: TABLE_CONTROL_MIN_SIZE_PX,
				minHeight: TABLE_CONTROL_MIN_SIZE_PX,
			}}
			aria-label={resolveEditorMessage(editor, "pen.table.addRow")}
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			onMouseDown={handleControlMouseDown}
			onClick={handleAddRow}
		>
			<span>+</span>
		</button>
	);

	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="table"
			data-selected={ctx.selected ? "" : undefined}
		>
			<div className="pen-table-shell">
				<div className="pen-table-main">
					<div
						{...{ [DATA_ATTRS.tableFrame]: "" }}
						data-selected={ctx.selected ? "" : undefined}
					>
						<table {...{ [DATA_ATTRS.table]: "" }}>
							{hasHeaderRow && headerCells && (
								<thead>
									<tr data-pen-table-row="" data-row="header">
										{headerCells}
									</tr>
								</thead>
							)}
							<tbody>{bodyRows}</tbody>
						</table>
					</div>
					{addRowControl}
				</div>
				{addColumnControl}
			</div>
		</div>
	);
}

export function TableRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return <TableRendererInner block={block} ctx={ctx} />;
}
