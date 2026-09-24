import { defineBlock } from "@input/pen-core";
import { directionProp } from "../directionProp";
import {
	textAlignmentProp,
	textAlignmentStyle,
} from "../textAlignmentProp";

export const paragraph = defineBlock("paragraph", {
	props: {
		direction: directionProp,
		textAlignment: textAlignmentProp,
	},
	content: "inline",
	fieldEditor: "richtext",
	placeholder: "Text",
	display: {
		title: "Paragraph",
		description: "Plain text paragraph",
		group: "basic",
		aliases: ["p", "text"],
	},
	serialize: {
		toMarkdown: (block) => block.content ?? "",
		toHTML: (block) => {
			// SEC5: alignment is serialized from a closed enum; content is serialized inline HTML.
			return `<p${textAlignmentStyle(block.props.textAlignment)}>${block.content ?? ""}</p>`;
		},
	},
});
