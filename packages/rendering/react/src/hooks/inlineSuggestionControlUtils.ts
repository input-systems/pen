import type { Editor } from "@input/pen-types";
import type {
	PersistentSuggestion,
	PersistentTextSuggestion,
} from "@input/pen-ai";
import type { useAIActions } from "./useAIActions";
import type { InlineSuggestionControlPosition } from "./useInlineSuggestionControls";
import { areAdjacentSiblingBlocks } from "@input/pen-dom/utils/parentIdTree";
import { querySuggestionAnchorElements } from "../utils/aiDomScope";

const SUGGESTION_CONTROL_VIEWPORT_PADDING = 8;
const SUGGESTION_CONTROL_WIDTH_ESTIMATE = 268;
const SUGGESTION_CONTROL_HEIGHT_ESTIMATE = 40;

export function dedupeSuggestionsById<
	TSuggestion extends { id: string; action: "insert" | "delete" },
>(suggestions: readonly TSuggestion[]): readonly TSuggestion[] {
	const seenSuggestionIds = new Set<string>();
	const dedupedSuggestions: TSuggestion[] = [];
	for (const suggestion of suggestions) {
		if (seenSuggestionIds.has(suggestion.id)) {
			continue;
		}
		seenSuggestionIds.add(suggestion.id);
		dedupedSuggestions.push(suggestion);
	}
	return dedupedSuggestions;
}

export function isTextSuggestion(
	suggestion: PersistentSuggestion,
): suggestion is PersistentTextSuggestion {
	return suggestion.kind === "text";
}

export function resolveSuggestionControlPositions(
	editor: Editor,
	suggestions: readonly { id: string; action: "insert" | "delete" }[],
	options?: { placement?: "anchor" | "right-rail" },
): readonly InlineSuggestionControlPosition[] {
	const visibleAnchors = resolveVisibleSuggestionAnchors(editor, suggestions);
	if (visibleAnchors.length === 0) {
		return [];
	}

	const groups: InlineSuggestionControlPosition[] = [];
	let currentGroup: SuggestionAnchor[] = [];

	for (const anchor of visibleAnchors) {
		const previousAnchor = currentGroup[currentGroup.length - 1];
		if (
			!previousAnchor ||
			shouldGroupSuggestionAnchors(editor, previousAnchor, anchor)
		) {
			currentGroup.push(anchor);
			continue;
		}
		const resolvedGroup = toSuggestionControlPosition(
			currentGroup,
			options?.placement ?? "anchor",
		);
		if (resolvedGroup) {
			groups.push(resolvedGroup);
		}
		currentGroup = [anchor];
	}

	const trailingGroup = toSuggestionControlPosition(
		currentGroup,
		options?.placement ?? "anchor",
	);
	if (trailingGroup) {
		groups.push(trailingGroup);
	}

	return groups;
}

export function resolveSuggestionAnchorElements(
	editor: Editor,
	suggestionIds: readonly string[],
): HTMLElement[] {
	if (suggestionIds.length === 0) {
		return [];
	}
	const suggestionIdSet = new Set(suggestionIds);
	return querySuggestionAnchorElements(editor).filter((element) => {
		if (!isRenderableSuggestionAnchor(element)) {
			return false;
		}
		const suggestionId = element.dataset.suggestionId;
		return suggestionId ? suggestionIdSet.has(suggestionId) : false;
	});
}

export function scrollSuggestionIntoView(
	suggestionElements: readonly HTMLElement[],
): void {
	const firstVisibleElement = suggestionElements.find((suggestionElement) => {
		const rect = suggestionElement.getBoundingClientRect();
		return rect.width > 0 || rect.height > 0;
	});
	if (!firstVisibleElement) {
		return;
	}

	const scrollContainer = findNearestScrollContainer(firstVisibleElement);
	if (!scrollContainer) {
		if (typeof firstVisibleElement.scrollIntoView === "function") {
			firstVisibleElement.scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});
		}
		return;
	}

	const containerRect = scrollContainer.getBoundingClientRect();
	const elementRect = firstVisibleElement.getBoundingClientRect();
	const topPadding = 96;
	const bottomPadding = 180;

	if (elementRect.top < containerRect.top + topPadding) {
		const nextTop =
			scrollContainer.scrollTop -
			(containerRect.top + topPadding - elementRect.top);
		setScrollContainerTop(scrollContainer, nextTop);
		return;
	}

	if (elementRect.bottom > containerRect.bottom - bottomPadding) {
		const nextTop =
			scrollContainer.scrollTop +
			(elementRect.bottom - (containerRect.bottom - bottomPadding));
		setScrollContainerTop(scrollContainer, nextTop);
	}
}

function setScrollContainerTop(
	scrollContainer: HTMLElement,
	nextTop: number,
): void {
	scrollContainer.scrollTop = nextTop;
}

function findNearestScrollContainer(element: HTMLElement): HTMLElement | null {
	let currentElement = element.parentElement;
	while (currentElement) {
		const computedStyle = window.getComputedStyle(currentElement);
		const canScrollY =
			(computedStyle.overflowY === "auto" ||
				computedStyle.overflowY === "scroll") &&
			currentElement.scrollHeight > currentElement.clientHeight;
		if (canScrollY) {
			return currentElement;
		}
		currentElement = currentElement.parentElement;
	}
	const editorContent = element.closest("[data-pen-editor-content]");
	if (editorContent?.parentElement) {
		return editorContent.parentElement;
	}
	return element.parentElement;
}

function resolveSuggestionControlHost(
	element: HTMLElement,
	scrollContainer: HTMLElement,
): HTMLElement {
	const editorContent = element.closest("[data-pen-editor-content]");
	if (editorContent instanceof HTMLElement) {
		return editorContent;
	}
	return scrollContainer;
}

interface SuggestionAnchor {
	suggestionId: string;
	action: "insert" | "delete";
	blockId: string | null;
	element: HTMLElement;
	rect: DOMRect;
}

function resolveVisibleSuggestionAnchors(
	editor: Editor,
	suggestions: readonly { id: string; action: "insert" | "delete" }[],
): readonly SuggestionAnchor[] {
	const suggestionActions = new Map(
		suggestions.map((suggestion) => [suggestion.id, suggestion.action]),
	);
	return querySuggestionAnchorElements(editor).flatMap((element) => {
		if (!isRenderableSuggestionAnchor(element)) {
			return [];
		}
		const suggestionId = element.dataset.suggestionId;
		if (!suggestionId) {
			return [];
		}
		const action = suggestionActions.get(suggestionId);
		if (!action) {
			return [];
		}
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) {
			return [];
		}
		return [
			{
				suggestionId,
				action,
				blockId:
					element
						.closest("[data-block-id]")
						?.getAttribute("data-block-id") ?? null,
				element,
				rect,
			},
		];
	});
}

function isRenderableSuggestionAnchor(element: HTMLElement): boolean {
	return !element.hasAttribute("data-pen-ai-inline-suggestion-control");
}

function shouldGroupSuggestionAnchors(
	editor: Editor,
	previousAnchor: SuggestionAnchor,
	nextAnchor: SuggestionAnchor,
): boolean {
	return (
		previousAnchor.blockId === nextAnchor.blockId ||
		areAdjacentSuggestionBlocks(editor, previousAnchor, nextAnchor)
	);
}

/**
 * Adjacent sibling blocks in model order: an AX1 list group wraps some
 * siblings and not others, so a shared `parentElement` no longer means
 * "neighbours" (W6.R6).
 */
function areAdjacentSuggestionBlocks(
	editor: Editor,
	previousAnchor: SuggestionAnchor,
	nextAnchor: SuggestionAnchor,
): boolean {
	const { blockId: previousId } = previousAnchor;
	const { blockId: nextId } = nextAnchor;
	if (!previousId || !nextId) {
		return false;
	}
	return areAdjacentSiblingBlocks(editor, previousId, nextId);
}

function toSuggestionControlPosition(
	anchors: readonly SuggestionAnchor[],
	placement: "anchor" | "right-rail",
): InlineSuggestionControlPosition | null {
	if (anchors.length === 0) {
		return null;
	}
	if (!hasMeaningfulSuggestionContent(anchors)) {
		return null;
	}
	const bottom = Math.max(...anchors.map((anchor) => anchor.rect.bottom));
	const scrollContainer = findNearestScrollContainer(anchors[0]!.element);
	if (!scrollContainer) {
		return null;
	}
	const host = resolveSuggestionControlHost(
		anchors[0]!.element,
		scrollContainer,
	);
	const hostRect = host.getBoundingClientRect();
	const suggestionIds = dedupeSuggestionIds(
		anchors.map((anchor) => anchor.suggestionId),
	);
	const groupActions = new Set(anchors.map((anchor) => anchor.action));
	return {
		id: suggestionIds[0] ?? anchors[0]!.suggestionId,
		action: groupActions.size > 1 ? "mixed" : anchors[0]!.action,
		suggestionIds,
		host,
		top: clampSuggestionControlTop(bottom - hostRect.top + 8, host),
		left: clampSuggestionControlLeft(host),
		placement,
	};
}

function hasMeaningfulSuggestionContent(
	anchors: readonly SuggestionAnchor[],
): boolean {
	return anchors.some(
		(anchor) => (anchor.element.textContent ?? "").trim().length > 0,
	);
}

function dedupeSuggestionIds(
	suggestionIds: readonly string[],
): readonly string[] {
	return [...new Set(suggestionIds)];
}

function clampSuggestionControlLeft(host: HTMLElement): number {
	const minLeft = SUGGESTION_CONTROL_VIEWPORT_PADDING;
	const maxLeft =
		host.clientWidth -
		SUGGESTION_CONTROL_WIDTH_ESTIMATE -
		SUGGESTION_CONTROL_VIEWPORT_PADDING;
	return Math.max(minLeft, maxLeft);
}

function clampSuggestionControlTop(
	preferredTop: number,
	host: HTMLElement,
): number {
	const minTop = SUGGESTION_CONTROL_VIEWPORT_PADDING;
	const maxTop =
		host.clientHeight -
		SUGGESTION_CONTROL_HEIGHT_ESTIMATE -
		SUGGESTION_CONTROL_VIEWPORT_PADDING;
	return Math.max(minTop, Math.min(preferredTop, maxTop));
}

export function areSuggestionControlPositionsEqual(
	previous: readonly InlineSuggestionControlPosition[],
	next: readonly InlineSuggestionControlPosition[],
): boolean {
	if (previous.length !== next.length) {
		return false;
	}
	for (let index = 0; index < previous.length; index += 1) {
		const previousPosition = previous[index];
		const nextPosition = next[index];
		if (
			!previousPosition ||
			!nextPosition ||
			previousPosition.id !== nextPosition.id ||
			previousPosition.action !== nextPosition.action ||
			previousPosition.host !== nextPosition.host ||
			previousPosition.placement !== nextPosition.placement ||
			previousPosition.suggestionIds.length !==
				nextPosition.suggestionIds.length ||
			previousPosition.suggestionIds.some(
				(suggestionId, suggestionIndex) =>
					suggestionId !==
					nextPosition.suggestionIds[suggestionIndex],
			) ||
			previousPosition.top !== nextPosition.top ||
			previousPosition.left !== nextPosition.left
		) {
			return false;
		}
	}
	return true;
}

export function acceptSuggestionGroup(
	actions: ReturnType<typeof useAIActions>,
	suggestionIds: readonly string[],
): readonly string[] {
	const acceptedSuggestionIds: string[] = [];
	for (const suggestionId of suggestionIds) {
		if (actions.acceptSuggestion(suggestionId)) {
			acceptedSuggestionIds.push(suggestionId);
		}
	}
	return acceptedSuggestionIds;
}

export function rejectSuggestionGroup(
	actions: ReturnType<typeof useAIActions>,
	suggestionIds: readonly string[],
): readonly string[] {
	const rejectedSuggestionIds: string[] = [];
	for (const suggestionId of suggestionIds) {
		if (actions.rejectSuggestion(suggestionId)) {
			rejectedSuggestionIds.push(suggestionId);
		}
	}
	return rejectedSuggestionIds;
}

export function resolveSuggestionGroupOptimistically(
	setResolvingSuggestionIds: React.Dispatch<
		React.SetStateAction<readonly string[]>
	>,
	suggestionIds: readonly string[],
	resolveSuggestionGroup: () => readonly string[],
): readonly string[] {
	setResolvingSuggestionIds((currentIds) => [
		...currentIds,
		...suggestionIds.filter(
			(suggestionId) => !currentIds.includes(suggestionId),
		),
	]);
	const resolvedSuggestionIds = resolveSuggestionGroup();
	if (resolvedSuggestionIds.length === suggestionIds.length) {
		return resolvedSuggestionIds;
	}
	const resolvedSuggestionIdSet = new Set(resolvedSuggestionIds);
	const unresolvedSuggestionIds = suggestionIds.filter(
		(suggestionId) => !resolvedSuggestionIdSet.has(suggestionId),
	);
	if (unresolvedSuggestionIds.length > 0) {
		setResolvingSuggestionIds((currentIds) =>
			currentIds.filter(
				(suggestionId) =>
					!unresolvedSuggestionIds.includes(suggestionId),
			),
		);
	}
	return resolvedSuggestionIds;
}
