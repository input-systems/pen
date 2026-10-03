import type {
	BlockScrollAlign,
	SelectionRecord,
	SelectionState,
} from "@input/pen-types";
import { getRootGeometry } from "../geometry/rootGeometry";
import type { GeometryReader, Rect } from "../geometry/types";

/** A projection's scroll option (W3.R15): automatic, off, or a fixed alignment. */
export type ProjectionScroll =
	"auto" | "none" | { readonly align: BlockScrollAlign };

/** The last commit the field editor saw, classified by origin type. */
export type ProjectionCommit = {
	readonly commitId: number;
	readonly originType: string;
};

const AUTO_SCROLL_ORIGINS: ReadonlySet<string> = new Set([
	"keyboard",
	"ime",
	"restore",
]);

/**
 * Whether projecting `record` scrolls its target into view, and how (P,
 * W3.R15). `"auto"` scrolls `nearest` for keyboard, IME and restored (undo,
 * redo) records, and for a `mapped` record produced by a local `user`
 * commit; it never scrolls for pointer, programmatic, gc, or a record mapped
 * through another peer's, the AI's or a history commit, so a collaborator's
 * typing never moves the local viewport.
 */
export function resolveProjectionScroll(
	record: SelectionRecord,
	commit: ProjectionCommit | null,
	option: ProjectionScroll,
): { readonly align: BlockScrollAlign } | null {
	if (option === "none") {
		return null;
	}
	if (option !== "auto") {
		return { align: option.align };
	}
	if (AUTO_SCROLL_ORIGINS.has(record.origin)) {
		return { align: "nearest" };
	}
	const isLocalUserMapping =
		record.origin === "mapped" &&
		commit !== null &&
		commit.commitId === record.commitId &&
		commit.originType === "user";
	return isLocalUserMapping ? { align: "nearest" } : null;
}

/**
 * The rect to bring into view for a selection: the caret, or the head block.
 * For `nearest`, a caret whose block is wholly inside `view` is already in
 * view, so the block's one rect answers before any line-box measurement.
 */
export function selectionScrollTarget(
	reader: GeometryReader,
	state: SelectionState | null,
	view: Rect,
	align: BlockScrollAlign,
): Rect | null {
	switch (state?.type) {
		case "text": {
			const block = reader.blockRect(state.focus.blockId);
			if (align === "nearest" && block && containsRect(view, block)) {
				return null;
			}
			return reader.caretRect(
				state.focus,
				state.affinity ?? "downstream",
			);
		}
		case "block": {
			const head =
				state.head ?? state.blockIds[state.blockIds.length - 1];
			return head ? reader.blockRect(head) : null;
		}
		case "cell":
			return reader.blockRect(state.blockId);
		case "app":
		case undefined:
			return null;
		default: {
			const unreachable: never = state;
			return unreachable;
		}
	}
}

/** The nearest scrollable ancestor of `element`, else the document scroller. */
function findScrollContainer(element: Element): Element | null {
	const view = element.ownerDocument.defaultView;
	for (
		let current: Element | null = element;
		current;
		current = current.parentElement
	) {
		const style = view?.getComputedStyle(current);
		const scrolls =
			style !== undefined &&
			/(auto|scroll|overlay)/.test(
				`${style.overflowY} ${style.overflowX}`,
			) &&
			(current.scrollHeight > current.clientHeight ||
				current.scrollWidth > current.clientWidth);
		if (scrolls) {
			return current;
		}
	}
	return element.ownerDocument.scrollingElement;
}

/** How far to scroll so `target` sits in `view` at `align`; null when it already does. */
export function scrollDelta(
	view: Rect,
	target: Rect,
	align: BlockScrollAlign,
): { readonly dx: number; readonly dy: number } | null {
	const dy = axisDelta(
		view.top,
		view.bottom,
		target.top,
		target.bottom,
		align,
	);
	const dx = axisDelta(
		view.left,
		view.right,
		target.left,
		target.right,
		"nearest",
	);
	return dx === 0 && dy === 0 ? null : { dx, dy };
}

function axisDelta(
	viewStart: number,
	viewEnd: number,
	start: number,
	end: number,
	align: BlockScrollAlign,
): number {
	switch (align) {
		case "start":
			return start - viewStart;
		case "end":
			return end - viewEnd;
		case "center":
			return (start + end) / 2 - (viewStart + viewEnd) / 2;
		case "nearest":
			if (start < viewStart) return start - viewStart;
			if (end > viewEnd)
				return Math.min(end - viewEnd, start - viewStart);
			return 0;
		default: {
			const unreachable: never = align;
			return unreachable;
		}
	}
}

/** A scroll the write phase applies: `container` moves by `dx`, `dy`. */
export type ScrollPlan = {
	readonly container: Element;
	readonly dx: number;
	readonly dy: number;
};

/**
 * Read phase: measure `target` through the root's geometry reader and the
 * nearest scroll container's viewport, and return the scroll that brings
 * the target to `align`, or null when none is needed.
 */
export function measureScrollPlan(
	root: HTMLElement,
	align: BlockScrollAlign,
	measureTarget: (reader: GeometryReader, view: Rect) => Rect | null,
): ScrollPlan | null {
	const container = findScrollContainer(root);
	if (!container) {
		return null;
	}
	const view = viewportRect(container);
	const target = measureTarget(getRootGeometry(root).reader, view);
	const delta = target ? scrollDelta(view, target, align) : null;
	return delta ? { container, ...delta } : null;
}

function containsRect(view: Rect, rect: Rect): boolean {
	return (
		rect.top >= view.top &&
		rect.bottom <= view.bottom &&
		rect.left >= view.left &&
		rect.right <= view.right
	);
}

/** Write phase: apply a measured plan. */
export function applyScrollPlan(plan: ScrollPlan): void {
	plan.container.scrollTop += plan.dy;
	plan.container.scrollLeft += plan.dx;
}

function viewportRect(container: Element): Rect {
	const doc = container.ownerDocument;
	if (container === doc.scrollingElement) {
		const width = doc.defaultView?.innerWidth ?? 0;
		const height = doc.defaultView?.innerHeight ?? 0;
		return {
			x: 0,
			y: 0,
			width,
			height,
			top: 0,
			left: 0,
			right: width,
			bottom: height,
		};
	}
	return container.getBoundingClientRect();
}
