export type Affinity = "upstream" | "downstream";

export interface Point {
	readonly blockId: string;
	readonly offset: number;
}

export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly top: number;
	readonly left: number;
	readonly right: number;
	readonly bottom: number;
}

export interface BidiRun {
	readonly from: number;
	readonly to: number;
	readonly level: number;
}

export interface BidiRunGeometry {
	readonly run: BidiRun;
	readonly rect: Rect;
}

export interface LineBox {
	readonly top: number;
	readonly bottom: number;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly runs: readonly BidiRunGeometry[]; // visual order
}

export interface GeometryReader {
	caretRect(point: Point, affinity: Affinity): Rect | null;
	rangeRects(range: { anchor: Point; focus: Point }): readonly Rect[];
	lineBoxes(blockId: string): readonly LineBox[];
	pointAt(x: number, y: number): Point | null;
	blockRect(blockId: string): Rect | null;
	readonly generation: number;
}

export function rectFromDOMRect(rect: DOMRect): Rect {
	return {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
		top: rect.top,
		left: rect.left,
		right: rect.right,
		bottom: rect.bottom,
	};
}

export function rectToDOMRect(rect: Rect): DOMRect {
	return new DOMRect(rect.x, rect.y, rect.width, rect.height);
}

export function getDistanceToRect(
	rect: Pick<Rect, "left" | "right" | "top" | "bottom">,
	clientX: number,
	clientY: number,
): { dx: number; dy: number } {
	return {
		dx:
			clientX < rect.left
				? rect.left - clientX
				: clientX > rect.right
					? clientX - rect.right
					: 0,
		dy:
			clientY < rect.top
				? rect.top - clientY
				: clientY > rect.bottom
					? clientY - rect.bottom
					: 0,
	};
}

export function collapsedRect(x: number, top: number, height: number): Rect {
	return {
		x,
		y: top,
		width: 0,
		height,
		top,
		left: x,
		right: x,
		bottom: top + height,
	};
}

export function unionRects(rects: readonly Rect[]): Rect {
	const first = rects[0];
	if (!first) {
		return collapsedRect(0, 0, 0);
	}
	let left = first.left;
	let top = first.top;
	let right = first.right;
	let bottom = first.bottom;
	for (const rect of rects.slice(1)) {
		left = Math.min(left, rect.left);
		top = Math.min(top, rect.top);
		right = Math.max(right, rect.right);
		bottom = Math.max(bottom, rect.bottom);
	}
	return {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
		top,
		left,
		right,
		bottom,
	};
}

export function rectCenterX(rect: Rect): number {
	return rect.left + rect.width / 2;
}

export function rectCenterY(rect: Rect): number {
	return rect.top + rect.height / 2;
}

/** One block's live box, in the order a whole-root walk lists blocks. */
export type BlockRectEntry = {
	readonly id: string;
	readonly rect: Rect;
};

export function isUsefulRect(rect: Pick<DOMRect, "width" | "height">): boolean {
	return rect.width > 0 || rect.height > 0;
}

/** glyph box; excludes collapsed caret and WebKit bidi-boundary ghosts */
export function isInkRect(rect: Pick<DOMRect, "width">): boolean {
	return rect.width > 0;
}

export function singleRunLineBox(
	rect: Rect,
	startOffset: number,
	endOffset: number,
): LineBox {
	return {
		top: rect.top,
		bottom: rect.bottom,
		startOffset,
		endOffset,
		runs: [
			{
				run: { from: startOffset, to: endOffset, level: 0 },
				rect,
			},
		],
	};
}
