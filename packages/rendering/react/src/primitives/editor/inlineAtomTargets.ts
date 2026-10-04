import type { SchemaRegistry } from "@input/pen-types";
import {
	INLINE_ATOM_REPLACEMENT_TEXT,
	resolveInlineAtomDisplayText,
	resolveInlineAtomInsert,
} from "@input/pen-dom/field-editor/inlineAtomModel";
import { isInlineAtomSelectedInSlice } from "@input/pen-dom/utils/inlineAtomSelection";
import { replaceElementChildren } from "@input/pen-dom/utils/replaceElementChildren";
import type { InlineAtomRenderers } from "../../context/editorContext";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";

export interface InlineAtomRenderTarget {
	key: string;
	element: HTMLElement;
	type: string;
	props: Record<string, unknown>;
	text: string;
	offset: number;
}

export function resolveNextInlineAtomTargets(
	root: HTMLElement | null,
	renderers: InlineAtomRenderers | undefined,
	registry: Pick<SchemaRegistry, "resolveInline">,
	deltas: readonly {
		insert: string | Record<string, unknown>;
	}[],
	currentTargets: InlineAtomRenderTarget[],
): InlineAtomRenderTarget[] {
	if (!root) {
		return currentTargets.length === 0 ? currentTargets : [];
	}

	const descriptors = getInlineAtomDescriptors(deltas, registry);
	const atomElements = Array.from(
		root.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.inlineAtom}]`),
	);
	const nextTargets = atomElements.flatMap(
		(element, index): InlineAtomRenderTarget[] => {
			const data = descriptors[index];
			if (!data) {
				return [];
			}

			const renderer = renderers?.[data.type];
			if (renderer) {
				clearInlineAtomFallbackText(element, data.text);
			}

			return [
				{
					key: getInlineAtomTargetKey(data, index),
					element,
					type: data.type,
					props: data.props,
					text: data.text,
					offset: data.offset,
				},
			];
		},
	);

	return areInlineAtomTargetsEqual(currentTargets, nextTargets)
		? currentTargets
		: nextTargets;
}

function getInlineAtomDescriptors(
	deltas: readonly {
		insert: string | Record<string, unknown>;
	}[],
	registry: Pick<SchemaRegistry, "resolveInline">,
): Array<{
	type: string;
	props: Record<string, unknown>;
	text: string;
	offset: number;
}> {
	const descriptors: Array<{
		type: string;
		props: Record<string, unknown>;
		text: string;
		offset: number;
	}> = [];
	let offset = 0;

	for (const delta of deltas) {
		if (typeof delta.insert === "string") {
			offset += delta.insert.length;
			continue;
		}

		const atom = resolveInlineAtomInsert(delta.insert);
		if (atom) {
			descriptors.push({
				...atom,
				text: resolveInlineAtomDisplayText(atom, registry),
				offset,
			});
		}
		offset += 1;
	}

	return descriptors;
}

export { isInlineAtomSelectedInSlice };

function areInlineAtomTargetsEqual(
	currentTargets: InlineAtomRenderTarget[],
	nextTargets: InlineAtomRenderTarget[],
): boolean {
	if (currentTargets.length !== nextTargets.length) {
		return false;
	}

	return currentTargets.every((target, index) => {
		const nextTarget = nextTargets[index];
		return (
			target.key === nextTarget.key &&
			target.element === nextTarget.element &&
			target.offset === nextTarget.offset &&
			target.text === nextTarget.text &&
			target.type === nextTarget.type &&
			areAtomRecordsEqual(target.props, nextTarget.props)
		);
	});
}

function getInlineAtomTargetKey(
	data: { type: string; text: string },
	index: number,
): string {
	return `${index}:${data.type}:${data.text}`;
}

function clearInlineAtomFallbackText(element: HTMLElement, text: string): void {
	if (
		element.childNodes.length === 1 &&
		element.firstChild?.nodeType === Node.TEXT_NODE &&
		element.textContent === text
	) {
		replaceElementChildren(element);
		return;
	}

	for (const child of Array.from(element.childNodes)) {
		if (
			child.nodeType === Node.TEXT_NODE &&
			(child.textContent === text ||
				child.textContent === INLINE_ATOM_REPLACEMENT_TEXT)
		) {
			child.remove();
		}
	}
}

function areAtomRecordsEqual(
	left: Record<string, unknown>,
	right: Record<string, unknown>,
): boolean {
	if (left === right) {
		return true;
	}

	const leftKeys = definedAtomRecordKeys(left);
	const rightKeys = definedAtomRecordKeys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	for (const key of leftKeys) {
		if (!Object.is(left[key], right[key])) {
			return false;
		}
	}

	return true;
}

function definedAtomRecordKeys(record: Record<string, unknown>): string[] {
	const keys: string[] = [];
	for (const key of Object.keys(record)) {
		if (record[key] !== undefined) {
			keys.push(key);
		}
	}
	return keys;
}
