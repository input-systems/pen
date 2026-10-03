import type { BlockDirection } from "../bidi";
import { isEmptyBlockPlaceholder } from "../field-editor/emptyBlockPlaceholder";
import { isTrailingLineBreak } from "../field-editor/trailingLineBreak";
import {
	getLogicalNodeLength,
	getLogicalTextContent,
	isInlineAtomHostNode,
	isInlineAtomNode,
} from "../field-editor/inlineAtomDom";
import {
	findInlineContentElement,
	queryBlockElement,
	queryInlineElement,
} from "../field-editor/selectionDomQueries";
import { attachBidiRunsToLines } from "./bidiRunGeometry";
import {
	LINE_TOP_EPSILON,
	characterRect,
	elementRect,
	findAtomHost,
	measureLogicalRange,
	readLineRects,
} from "./geometryMeasure";
import type { BidiRun, LineBox, Rect } from "./types";
import { isUsefulRect, rectFromDOMRect, unionRects } from "./types";

export function measureLineBoxes(
	root: HTMLElement,
	blockId: string,
): readonly LineBox[] {
	const blockEl = queryBlockElement(root, blockId);
	if (!blockEl) {
		return [];
	}

	const inlineEl =
		findInlineContentElement(blockEl) ?? queryInlineElement(root, blockId);
	const base = readBlockDirection(blockEl, inlineEl);
	if (!inlineEl) {
		const rect = elementRect(blockEl);
		return rect
			? attachBidiRunsToLines(
					[
						{
							top: rect.top,
							bottom: rect.bottom,
							start: 0,
							end: 0,
							rect,
						},
					],
					"",
					base,
				)
			: [];
	}

	const text = getLogicalTextContent(inlineEl);
	const length = getLogicalNodeLength(inlineEl);
	const measureRun = (run: BidiRun): Rect | null =>
		measureLogicalRange(root, inlineEl, run.from, run.to);
	const fragments = collectLineFragments(root, inlineEl);
	if (fragments.length === 0) {
		const rect = elementRect(inlineEl) ?? elementRect(blockEl);
		return rect
			? attachBidiRunsToLines(
					[
						{
							top: rect.top,
							bottom: rect.bottom,
							start: 0,
							end: length,
							rect,
						},
					],
					text,
					base,
					measureRun,
				)
			: [];
	}

	return groupFragmentsIntoLineBoxes(fragments, text, base, measureRun);
}

function readBlockDirection(
	blockEl: HTMLElement,
	inlineEl: HTMLElement | null,
): BlockDirection {
	if (inlineEl?.getAttribute("dir") === "rtl") {
		return "rtl";
	}
	if (blockEl.getAttribute("dir") === "rtl") {
		return "rtl";
	}
	return "ltr";
}

type LineFragment = {
	rect: Rect;
	start: number;
	end: number;
	/** An inline atom's host box: joins a text line without growing it. */
	atom?: boolean;
};

function collectLineFragments(
	root: HTMLElement,
	inlineEl: HTMLElement,
): LineFragment[] {
	const fragments: LineFragment[] = [];
	let offset = 0;

	const visit = (node: Node): void => {
		// Both of these are `<br>` elements that own a line box no text lands in:
		// the placeholder for an empty block, and RI5's break after a trailing
		// `\n`. Without a fragment the line is invisible to vertical motion, which
		// would then step past it to the adjacent block.
		if (isEmptyBlockPlaceholder(node) || isTrailingLineBreak(node)) {
			const rect = elementRect(node as HTMLElement);
			if (isUsefulRect(rect)) {
				fragments.push({ rect, start: offset, end: offset });
			}
			return;
		}

		if (isInlineAtomHostNode(node) || isInlineAtomNode(node)) {
			const length = getLogicalNodeLength(node);
			const host = isInlineAtomHostNode(node)
				? node
				: (findAtomHost(node) ?? node);
			const rect = elementRect(host as HTMLElement);
			if (rect) {
				fragments.push({ rect, start: offset, end: offset + length, atom: true });
			}
			offset += length;
			return;
		}

		if (node.nodeType === Node.TEXT_NODE) {
			const length = getLogicalNodeLength(node);
			if (length > 0 && node instanceof Text) {
				fragments.push(
					...fragmentsForTextNode(
						root,
						inlineEl,
						node,
						offset,
						offset + length,
					),
				);
			}
			offset += length;
			return;
		}

		for (const child of Array.from(node.childNodes)) {
			visit(child);
		}
	};

	visit(inlineEl);
	return fragments;
}

function fragmentsForTextNode(
	root: HTMLElement,
	inlineEl: HTMLElement,
	node: Text,
	logicalStart: number,
	logicalEnd: number,
): LineFragment[] {
	const doc = root.ownerDocument;
	const range = doc.createRange();
	try {
		range.selectNodeContents(node);
	} catch {
		// detached text node.
		return [];
	}
	const rects = readLineRects(range);
	if (rects.length === 0) {
		return [];
	}
	if (rects.length === 1 && rects[0]) {
		return [
			{
				rect: rectFromDOMRect(rects[0]),
				start: logicalStart,
				end: logicalEnd,
			},
		];
	}

	const splits = [logicalStart];
	for (let index = 1; index < rects.length; index += 1) {
		const lineTop = rects[index]?.top;
		if (lineTop === undefined) {
			splits.push(logicalEnd);
			continue;
		}
		splits.push(
			findFirstOffsetOnLine(
				root,
				inlineEl,
				splits[index - 1] ?? logicalStart,
				logicalEnd,
				lineTop,
			),
		);
	}
	splits.push(logicalEnd);

	return rects.flatMap((rect, index) => {
		const start = splits[index] ?? logicalStart;
		const end = splits[index + 1] ?? logicalEnd;
		return [{ rect: rectFromDOMRect(rect), start, end }];
	});
}

function findFirstOffsetOnLine(
	root: HTMLElement,
	inlineEl: HTMLElement,
	from: number,
	to: number,
	lineTop: number,
): number {
	let lo = from;
	let hi = to;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		const rect = characterRect(root, inlineEl, mid);
		if (rect && rect.top + LINE_TOP_EPSILON >= lineTop) {
			hi = mid;
		} else {
			lo = mid + 1;
		}
	}
	return lo;
}

function groupFragmentsIntoLineBoxes(
	fragments: readonly LineFragment[],
	text: string,
	base: BlockDirection,
	measureRun: (run: BidiRun) => Rect | null,
): LineBox[] {
	// Text decides a line's top and bottom; a chip's own box (host padding,
	// borders) does not grow the line (G1). An atom joins the line its centre
	// falls on, and only a line with no text takes its extent from atoms.
	const byTop = (left: LineFragment, right: LineFragment) => {
		const top = left.rect.top - right.rect.top;
		return top !== 0 ? top : left.start - right.start;
	};
	const sorted = [
		...fragments.filter((fragment) => !fragment.atom).sort(byTop),
		...fragments.filter((fragment) => fragment.atom).sort(byTop),
	];

	const lines: {
		top: number;
		bottom: number;
		start: number;
		end: number;
		rects: Rect[];
	}[] = [];

	for (const fragment of sorted) {
		if (fragment.atom) {
			const centre = fragment.rect.top + fragment.rect.height / 2;
			const host = lines.find(
				(line) => line.top <= centre && centre <= line.bottom,
			);
			if (host) {
				host.start = Math.min(host.start, fragment.start);
				host.end = Math.max(host.end, fragment.end);
				host.rects.push(fragment.rect);
				continue;
			}
		}
		const last = fragment.atom ? undefined : lines[lines.length - 1];
		if (
			last &&
			Math.abs(fragment.rect.top - last.top) <= LINE_TOP_EPSILON
		) {
			last.bottom = Math.max(last.bottom, fragment.rect.bottom);
			last.start = Math.min(last.start, fragment.start);
			last.end = Math.max(last.end, fragment.end);
			last.rects.push(fragment.rect);
			continue;
		}
		lines.push({
			top: fragment.rect.top,
			bottom: fragment.rect.bottom,
			start: fragment.start,
			end: fragment.end,
			rects: [fragment.rect],
		});
	}

	lines.sort((left, right) => left.top - right.top || left.start - right.start);

	return attachBidiRunsToLines(
		lines.map((line) => ({
			top: line.top,
			bottom: line.bottom,
			start: line.start,
			end: line.end,
			rect: unionRects(line.rects),
		})),
		text,
		base,
		measureRun,
	);
}
