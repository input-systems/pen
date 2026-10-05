import { expectCheck, readCaretOverlay } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachLoadavg, clickOffsetAndAwaitCaret } from "../specHelpers";

const HELLO_ID = "hello-p1";

scenario(
	"O1: ordinary collapsed caret keeps the native caret; overlay is reserved for atom edges",
	async (s, page) => {
		// Spec O1: the native caret is the display inside the active field.
		// Do not load ?customCaret=1 — that flag mounts Pen.Editor.CaretOverlay,
		// the host opt-in that paints every collapsed caret. Forcing that mode
		// on and then requiring it not to paint tests the wrong mode.
		// Atom-edge overlay ink is the O1 scenario in live-rules.spec.ts.
		await s.load("hello-world");
		await clickOffsetAndAwaitCaret(page, HELLO_ID, 2);
		const overlay = await readCaretOverlay(page);
		await attachLoadavg("o1-ordinary", overlay);

		expectCheck(
			"O1: the overlay layer is mounted, so the absence is checkable",
			overlay.layerMounted,
		);
		expectCheck(
			"O1: ordinary caret is native, not overlay",
			!(overlay.caret && overlay.caretVisible),
			overlay,
		);
		expectCheck(
			"O1: native caret-color stays visible on an ordinary caret",
			overlay.caretColor !== "transparent",
			`caretColor=${overlay.caretColor}`,
		);
	},
);
