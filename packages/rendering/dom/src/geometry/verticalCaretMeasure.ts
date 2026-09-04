import {
	setVerticalCaretMeasure,
	type VerticalCaretMeasure,
} from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { measureWithRoot } from "./rootGeometry";
import { verticalCaretTarget } from "./verticalCaretTarget";

/**
 * G5 host wiring: `pen.caretUp` / `pen.caretDown` read geometry through
 * `setVerticalCaretMeasure`. Core cannot import this package.
 * Uses `measureWithRoot` so idle calls go through `measureNow` (SCH2).
 */
export function registerVerticalCaretMeasure(
	editor: Editor,
	root: HTMLElement,
): () => void {
	const measure: VerticalCaretMeasure = (_ed, current, direction, goalX) =>
		measureWithRoot(root, (host) =>
			verticalCaretTarget(
				host.reader,
				current,
				direction,
				goalX,
				current.affinity,
			),
		);
	setVerticalCaretMeasure(editor, measure);
	return () => {
		setVerticalCaretMeasure(editor, null);
	};
}
