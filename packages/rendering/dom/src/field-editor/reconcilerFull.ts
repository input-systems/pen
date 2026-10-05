import { sortDeltaAttributes } from "@input/pen-core";
import type {
	Editor,
	InlineDecoration,
	SchemaRegistry,
} from "@input/pen-types";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import type { UrlPolicy } from "../security/urlPolicy";
import type { FieldEditorDelta, FieldEditorTextLike } from "./crdt";
import {
	applyInlineDecorationsToDeltas,
	filterVisibleInlineDecorationDeltas,
} from "../utils/inlineDecorations";
import { createEmptyBlockPlaceholder } from "./emptyBlockPlaceholder";
import { createTrailingLineBreak } from "./trailingLineBreak";
import { createInlineAtomElement } from "./inlineAtomDom";
import { wrapWithMarks } from "./reconcilerMarks";
import { patchDOM } from "./reconcilerPatch";

type ReconcilePolicyOptions =
	| { editor: Editor; urlPolicy?: undefined }
	| { urlPolicy: UrlPolicy; editor?: undefined };

export function fullReconcileToDOM(
	ytext: FieldEditorTextLike,
	element: HTMLElement,
	registry: SchemaRegistry,
	options: ReconcilePolicyOptions & {
		inlineDecorations?: readonly InlineDecoration[];
	},
): void {
	const textDeltas = ytext.toDelta().filter(
		(
			delta,
		): delta is FieldEditorDelta & {
			insert: string | Record<string, unknown>;
		} => delta.insert != null,
	);
	const renderedDeltas =
		options.inlineDecorations && options.inlineDecorations.length > 0
			? filterVisibleInlineDecorationDeltas(
					applyInlineDecorationsToDeltas(
						textDeltas,
						options.inlineDecorations,
					),
				)
			: textDeltas;
	fullReconcileDeltasToDOM(renderedDeltas, element, registry, options);
}

/**
 * Rebuilds `element` from `deltas`. A reconcile never saves or restores the
 * native selection: when it rebuilds a mounted projection target, the caller
 * asks the field editor to project the authority in the same turn (P3).
 */
export function fullReconcileDeltasToDOM(
	deltas: FieldEditorDelta[],
	element: HTMLElement,
	registry: SchemaRegistry,
	options: ReconcilePolicyOptions,
): void {
	const policy =
		options.editor !== undefined
			? urlPolicyFromEditor(options.editor)
			: options.urlPolicy;
	const orderedDeltas = deltas.map((delta) => {
		if (!delta.attributes || Object.keys(delta.attributes).length < 2) {
			return delta;
		}
		return {
			...delta,
			attributes: sortDeltaAttributes(delta.attributes, registry),
		};
	});

	const doc = element.ownerDocument;
	const fragment = doc.createDocumentFragment();
	let hasContent = false;
	let endsWithNewline = false;
	for (const delta of orderedDeltas) {
		if (delta.insert == null) continue;
		if (typeof delta.insert === "string" && delta.insert.length === 0) {
			continue;
		}
		hasContent = true;
		endsWithNewline =
			typeof delta.insert === "string" && delta.insert.endsWith("\n");
		let node: Node =
			typeof delta.insert === "string"
				? doc.createTextNode(delta.insert)
				: createInlineAtomElement(delta.insert, registry, doc);
		if (delta.attributes) {
			node = wrapWithMarks(node, delta.attributes, registry, policy);
		}
		fragment.appendChild(node);
	}
	if (!hasContent) {
		fragment.appendChild(createEmptyBlockPlaceholder(doc));
	} else if (endsWithNewline) {
		fragment.appendChild(createTrailingLineBreak(doc));
	}

	patchDOM(element, fragment);
}
