import React from "react";
import { useToolbarContext } from "../../context/toolbarContext";
import { useEditorContext } from "../../context/editorContext";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { getAttachedFieldEditor } from "../../utils/fieldEditor";
import { getConvertBlockOps } from "@input/pen-dom/field-editor/commands";
import {
	getStarterTableProps,
	getTableActivationTarget,
} from "../../utils/tableDefaults";

export interface ToolbarSelectProps extends AsChildProps {
	format: string;
	options?: Array<{ value: string; label: string }>;
	ref?: React.Ref<HTMLElement>;
}

export function ToolbarSelect(props: ToolbarSelectProps) {
	const { format, options, ...rest } = props;
	const { editor, state } = useToolbarContext();
	const { readonly } = useEditorContext();
	const resolvedOptions =
		format === "blockType" ? (options ?? state.blockTypeOptions) : options;
	const selectedValue = resolvedOptions?.some(
		(opt) => opt.value === state.blockType,
	)
		? (state.blockType ?? "")
		: "";

	const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		if (readonly) return;
		const value = event.target.value;

		if (format === "blockType") {
			const selection = editor.selection;
			if (!selection) return;

			const blockId =
				selection.type === "text"
					? selection.anchor.blockId
					: selection.type === "block" &&
						  selection.blockIds.length > 0
						? selection.blockIds[0]
						: null;

			if (!blockId) return;

			const block = editor.getBlock(blockId);
			const currentText = block?.textContent() ?? "";
			const isTable = value === "table";
			const tableActivationTarget = isTable
				? getTableActivationTarget(currentText)
				: null;
			const tableProps = isTable ? getStarterTableProps() : undefined;

			editor.apply(
				getConvertBlockOps(editor, {
					blockId,
					newType: value,
					newProps: tableProps,
				}),
				{ origin: "user" },
			);

			if (isTable && tableActivationTarget) {
				// W3.R8: activate in this turn; the table's mount ack attaches
				// the cell once it renders (P4).
				const fieldEditor = getAttachedFieldEditor(editor);
				fieldEditor?.activateCell?.(
					blockId,
					tableActivationTarget.row,
					tableActivationTarget.col,
				);
			}
		}
	};

	const selectOptions = resolvedOptions
		? resolvedOptions.map((opt) =>
				React.createElement(
					"option",
					{ key: opt.value, value: opt.value },
					opt.label,
				),
			)
		: null;

	const primitiveProps: Record<string, unknown> = {
		"data-pen-toolbar-select": "",
		"data-format": format,
		"data-current": state.blockType ?? undefined,
		value: selectedValue,
		onChange: handleChange,
	};

	return renderAsChild(
		{ ...rest, children: selectOptions ?? rest.children },
		"select",
		primitiveProps,
	);
}
