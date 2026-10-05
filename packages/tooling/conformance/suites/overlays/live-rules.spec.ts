import { expect, type Page } from "@playwright/test";
import {
	expectCheck,
	insertMention,
	readCaretOverlay,
	type CaretOverlay,
} from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachJson, clickOffsetAndAwaitCaret, logLoad } from "../specHelpers";

async function readOverlay(page: Page): Promise<CaretOverlay> {
	// The overlay paints in the scheduler flush after the selection commit
	// (SCH), so a read straight after the record moved can precede the paint
	// (WebKit, ~1 in 20). OV4 waits for that flush; the checks below report.
	await page.evaluate(() =>
		window.__penConformance.overlayMatchesAuthority(),
	);
	return readCaretOverlay(page);
}

scenario(
	"O1: collapsed caret adjacent to an inline atom keeps the overlay at that edge",
	async (s, page) => {
		const loads = logLoad("O1-atom");
		await s.load("hello-world");
		await s.apply([insertMention("hello-p1", 5)]);
		await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();
		await clickOffsetAndAwaitCaret(page, "hello-p1", 5);
		const overlay = await readOverlay(page);
		const atom = await page.evaluate(() => {
			const node = document.querySelector("[data-pen-inline-atom]");
			if (!(node instanceof HTMLElement)) {
				return null;
			}
			const box = node.getBoundingClientRect();
			return {
				left: box.left,
				right: box.right,
				top: box.top,
				width: box.width,
			};
		});
		await attachJson("o1-atom", { loads, overlay, atom });
		const caret = overlay.caret;

		expectCheck("O1: overlay host was checkable next to the atom", overlay.layerMounted);
		expectCheck("O1: mention atom is measurable", atom !== null, "data-pen-inline-atom missing");
		expectCheck("O1: overlay caret is drawn beside the atom", caret !== null, overlay);
		expectCheck("O1: overlay offset is the atom edge", caret?.offset === "5", `offset=${caret?.offset}`);
		expectCheck(
			"O1: overlay rect sits on the atom edge",
			atom != null &&
				caret != null &&
				caret.left + caret.width >= atom.left - 4 &&
				caret.left <= atom.right + 4,
			`overlay.left=${caret?.left} atom=${JSON.stringify(atom)}`,
		);
		expectCheck(
			"O1: the native caret is hidden beside the atom",
			overlay.caretColor === "transparent",
			`caretColor=${overlay.caretColor}`,
		);
	},
);

scenario(
	"O2: empty text block draws an overlay caret with non-zero height",
	async (s, page) => {
		const loads = logLoad("O2");
		await s.load("empty");
		const overlay = await readOverlay(page);
		await attachJson("o2-empty", { loads, overlay });
		const caret = overlay.caret;

		expectCheck("O2: overlay host was checkable on the empty block", overlay.layerMounted);
		expectCheck("O2: empty block uses the overlay caret", caret !== null, overlay);
		expectCheck("O2: overlay is on empty-p1", caret?.blockId === "empty-p1", `blockId=${caret?.blockId}`);
		expectCheck(
			"O2: empty-block caret height is not collapsed",
			(caret?.height ?? 0) > 0,
			`box=${caret?.width}x${caret?.height}`,
		);
		expectCheck(
			"O2: native caret-color is transparent on empty",
			overlay.caretColor === "transparent",
			`caretColor=${overlay.caretColor}`,
		);
	},
);
