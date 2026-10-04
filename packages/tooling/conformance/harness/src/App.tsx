import type { Editor, TableColumnSchema } from "@input/pen-types";
import { useState, useSyncExternalStore, type ReactElement } from "react";
import { Pen } from "../../../../rendering/react/src/primitives";
import { ColumnHeaderMenu } from "../../../../rendering/react/src/renderers/tableColumnMenu";
import { isWindowedFixture } from "../../src/windowedRange";
import { getHarnessSession, getWindowStart, subscribeHarness } from "./session";
import { WindowedContent } from "./windowedContent";

function readQueryFlag(name: string): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	return new URLSearchParams(window.location.search).get(name) === "1";
}

function Ax3BlockHandle({
	blockId,
}: {
	blockId: string;
}): ReactElement {
	return <Pen.Editor.BlockHandle blockId={blockId} />;
}

/** The `ax3-keyboard` table scenarios insert this block. */
const AX3_TABLE_ID = "ax3-table";

const AX3_FALLBACK_COLUMNS: readonly TableColumnSchema[] = [
	{ id: "ax3-col-1", title: "Column 1", type: "text" },
	{ id: "ax3-col-2", title: "Column 2", type: "text" },
];

/**
 * AX3 chrome for `?ax3=1`: a persistent formatting toolbar, the floating
 * selection toolbar, and a column header control that opens the table
 * column menu, so focus return is checked on real primitives in a browser.
 */
function Ax3Chrome({ editor }: { editor: Editor }): ReactElement {
	const [columnMenuAnchor, setColumnMenuAnchor] =
		useState<HTMLElement | null>(null);
	const tableProps = editor.getBlock(AX3_TABLE_ID)?.props;
	const columns =
		(tableProps?.columns as readonly TableColumnSchema[] | undefined) ??
		AX3_FALLBACK_COLUMNS;
	const firstColumn = columns[0] ?? AX3_FALLBACK_COLUMNS[0]!;
	const columnMenu = columnMenuAnchor ? (
		<ColumnHeaderMenu
			editor={editor}
			blockId={AX3_TABLE_ID}
			column={firstColumn}
			columnIndex={0}
			allColumns={columns}
			colCount={columns.length}
			anchorEl={columnMenuAnchor}
			anchorRect={columnMenuAnchor.getBoundingClientRect()}
			onClose={() => setColumnMenuAnchor(null)}
		/>
	) : null;

	return (
		<div data-pen-ax3-chrome="">
			<Pen.Toolbar.Root>
				<Pen.Toolbar.Toggle format="bold">Bold</Pen.Toolbar.Toggle>
				<Pen.Toolbar.Toggle format="italic">Italic</Pen.Toolbar.Toggle>
			</Pen.Toolbar.Root>
			<Pen.SelectionToolbar.Root>
				<Pen.SelectionToolbar.Content>
					<Pen.Toolbar.Toggle format="bold">Bold</Pen.Toolbar.Toggle>
				</Pen.SelectionToolbar.Content>
			</Pen.SelectionToolbar.Root>
			<button
				type="button"
				data-pen-ax3-column-header=""
				aria-haspopup="menu"
				aria-expanded={columnMenuAnchor !== null}
				onClick={(event) => setColumnMenuAnchor(event.currentTarget)}
			>
				{firstColumn.title}
			</button>
			{columnMenu}
		</div>
	);
}

function PseudoLocaleChrome({ editor }: { editor: Editor }) {
	const slashController = {
		confirm: () => false,
		dismiss: () => {},
		items: [
			{
				type: "paragraph",
				display: { title: "Paragraph", group: "basic" },
			},
		],
		open: true,
		query: "",
		select: () => {},
		selectedIndex: 0,
		setQuery: () => {},
		editor,
	};

	return (
		<>
			<Pen.SlashMenu.Root controller={slashController} editor={editor}>
				<Pen.SlashMenu.Input />
				<Pen.SlashMenu.List />
			</Pen.SlashMenu.Root>
			<Pen.Search.Root editor={editor}>
				<Pen.Search.Input />
				<Pen.Search.Results />
				<Pen.Search.Previous />
				<Pen.Search.Next />
			</Pen.Search.Root>
		</>
	);
}

function readGeneration(): number {
	return getHarnessSession().generation;
}

export function App() {
	// The bridge is live before React runs passive effects, so a `load()` that
	// lands between the first commit and an effect-time subscribe would never
	// re-render (HOST6 WebKit flake). useSyncExternalStore re-checks the
	// snapshot when it subscribes.
	const generation = useSyncExternalStore(subscribeHarness, readGeneration);
	const windowStart = useSyncExternalStore(subscribeHarness, getWindowStart);

	const session = getHarnessSession();
	const showPseudoLocaleChrome = readQueryFlag("pseudoLocale");
	const showAx3Chrome = readQueryFlag("ax3");
	const showCustomCaret = readQueryFlag("customCaret");
	const blinkCaret = readQueryFlag("blink");
	const readonly = readQueryFlag("readonly");
	const modal = readQueryFlag("modal");
	const showCol2Presence = readQueryFlag("col2");
	const windowed = isWindowedFixture(session.fixtureName);

	const editorRoot = (
		<Pen.Editor.Root
			key={generation}
			editor={session.editor}
			readonly={readonly}
			blockControls={showAx3Chrome ? Ax3BlockHandle : undefined}
			chrome={!readQueryFlag("unstyled")}
			data-blink={blinkCaret ? "" : undefined}
		>
			<div
				data-pen-conformance-harness=""
				data-fixture={session.fixtureName}
				data-generation={String(generation)}
			>
				{windowed ? (
					<WindowedContent windowStart={windowStart} />
				) : (
					<Pen.Editor.Content emptyPlaceholder="" />
				)}
				{showCustomCaret ? <Pen.Editor.CaretOverlay /> : null}
				{showCol2Presence ? (
					<>
						<Pen.Multiplayer.PresenceList />
						<Pen.Multiplayer.RemoteCursors />
						<Pen.Multiplayer.CaretOverlay />
					</>
				) : null}
				{showAx3Chrome ? (
					<>
						<Pen.SlashMenu.Root>
							<Pen.SlashMenu.List />
						</Pen.SlashMenu.Root>
						<Ax3Chrome editor={session.editor} />
					</>
				) : null}
				{showPseudoLocaleChrome ? (
					<PseudoLocaleChrome editor={session.editor} />
				) : null}
			</div>
		</Pen.Editor.Root>
	);

	// ?modal=1: a transformed and filtered ancestor, the containing-block
	// trap `2bae382d` fixed for the caret (OV2).
	return modal ? (
		<div
			data-pen-conformance-modal=""
			style={{ transform: "translateX(37px)", filter: "blur(0)" }}
		>
			{editorRoot}
		</div>
	) : (
		editorRoot
	);
}
