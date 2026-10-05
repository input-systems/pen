import React, { createElement, useSyncExternalStore } from "react";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";
import { createPortal } from "react-dom";
import type { BlockSelectionSlice } from "@input/pen-dom/field-editor/store";
import type { Editor } from "@input/pen-types";
import type {
	InlineAtomRenderers,
	ResolvedInlineAtomInteractions,
} from "../../context/editorContext";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
import {
	attachInlineAtomWrapperInteractions,
	getInlineAtomDragSnapshot,
	getInlineAtomRenderInteractionProps,
	isInlineAtomDragSource,
	subscribeInlineAtomDragSnapshot,
} from "@input/pen-dom";
import {
	isInlineAtomSelectedInSlice,
	type InlineAtomRenderTarget,
} from "./inlineAtomTargets";

export function InlineAtomPortalLayer(props: {
	editor: Editor;
	blockId: string;
	targets: InlineAtomRenderTarget[];
	renderers?: InlineAtomRenderers;
	/** This block's selection slice (SCALE6), not the editor selection. */
	selection: BlockSelectionSlice;
	interactions: ResolvedInlineAtomInteractions;
	readonly: boolean;
}) {
	const {
		editor,
		blockId,
		targets,
		renderers,
		selection,
		interactions,
		readonly,
	} = props;
	const inlineAtomDragSnapshot = useSyncExternalStore(
		subscribeInlineAtomDragSnapshot,
		getInlineAtomDragSnapshot,
		getInlineAtomDragSnapshot,
	);

	const inlineAtomPortals = targets.flatMap((target) => {
		const renderer = renderers?.[target.type];
		if (!renderer) {
			return [];
		}

		const selected = isInlineAtomSelectedInSlice(selection, target.offset);
		const dragging = isInlineAtomDragSource(
			inlineAtomDragSnapshot,
			editor,
			blockId,
			target.offset,
		);
		return [
			createPortal(
				createElement(renderer, {
					blockId,
					offset: target.offset,
					type: target.type,
					props: target.props,
					text: target.text,
					selected,
					interaction: getInlineAtomRenderInteractionProps(
						{
							element: target.element,
							editor,
							blockId,
							offset: target.offset,
							type: target.type,
							text: target.text,
							props: target.props,
							selected,
							interactions,
							readonly,
						},
						dragging,
					),
				}),
				target.element,
				target.key,
			),
		];
	});

	useIsomorphicLayoutEffect(() => {
		targets.forEach((target) => {
			target.element.toggleAttribute(
				DATA_ATTRS.selected,
				isInlineAtomSelectedInSlice(selection, target.offset),
			);
			target.element.toggleAttribute(
				DATA_ATTRS.inlineAtomDragging,
				isInlineAtomDragSource(
					inlineAtomDragSnapshot,
					editor,
					blockId,
					target.offset,
				),
			);
		});
	}, [blockId, editor, inlineAtomDragSnapshot, targets, selection]);

	useIsomorphicLayoutEffect(() => {
		const cleanups = targets.map((target) =>
			attachInlineAtomWrapperInteractions({
				element: target.element,
				editor,
				blockId,
				offset: target.offset,
				type: target.type,
				text: target.text,
				props: target.props,
				selected: isInlineAtomSelectedInSlice(selection, target.offset),
				interactions,
				readonly,
			}),
		);

		return () => {
			cleanups.forEach((cleanup) => cleanup());
		};
	}, [blockId, editor, interactions, targets, readonly, selection]);

	return <>{inlineAtomPortals}</>;
}
