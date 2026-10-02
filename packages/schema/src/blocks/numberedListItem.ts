import {
	defineBlock,
	prop,
} from "@input/pen-core";
import { directionProp } from "../directionProp";
import {
  textAlignmentProp,
  textAlignmentStyle,
} from "../textAlignmentProp";

export const numberedListItem = defineBlock("numberedListItem", {
  props: {
    indent: prop.number().default(0).min(0).describe("Nesting depth"),
    parentId: prop.string().optional().describe("Container parent block"),
    start: prop
      .number()
      .optional()
      .describe("Restart numbering from this value"),
    direction: directionProp,
    textAlignment: textAlignmentProp,
  },
  content: "inline",
  fieldEditor: "richtext",
  placeholder: "List",
  display: {
    title: "Numbered List",
    description: "Ordered list item",
    group: "lists",
    aliases: ["ol", "numbered", "ordered"],
  },
  serialize: {
    toMarkdown: (block) => {
      const indent = "  ".repeat((block.props.indent as number) ?? 0);
      const start = (block.props.start as number) ?? 1;
      return `${indent}${start}. ${block.content ?? ""}`;
    },
    toHTML: (block) => {
      // SEC5: alignment is serialized from a closed enum; content is serialized inline HTML.
      return `<li${textAlignmentStyle(block.props.textAlignment)}>${block.content ?? ""}</li>`;
    },
  },
});
