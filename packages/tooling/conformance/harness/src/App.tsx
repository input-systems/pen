import type { Editor } from "@input/pen-types";
import { useEffect, useState, type ReactElement } from "react";
import { Pen } from "../../../../rendering/react/src/primitives";
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

export function App() {
	const [generation, setGeneration] = useState(() => getHarnessSession().generation);
	const [windowStart, setWindowStart] = useState(getWindowStart);

	useEffect(() => {
		return subscribeHarness(() => {
			setGeneration(getHarnessSession().generation);
			setWindowStart(getWindowStart());
		});
	}, []);

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
					<Pen.SlashMenu.Root>
						<Pen.SlashMenu.List />
					</Pen.SlashMenu.Root>
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
