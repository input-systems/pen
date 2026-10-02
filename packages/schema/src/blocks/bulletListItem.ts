import {
	defineBlock,
	prop,
} from "@input/pen-core";
import { directionProp } from "../directionProp";
import {
  textAlignmentProp,
  textAlignmentStyle,
} from "../textAlignmentProp";

export const bulletListItem = defineBlock("bulletListItem", {
  props: {
    indent: prop.number().default(0).min(0).describe("Nesting depth"),
    parentId: prop.string().optional().describe("Container parent block"),
    direction: directionProp,
    textAlignment: textAlignmentProp,
  },
  content: "inline",
  fieldEditor: "richtext",
  placeholder: "List",
  display: {
    title: "Bullet List",
    description: "Unordered list item",
    group: "lists",
    aliases: ["ul", "bullet", "unordered"],
  },
  serialize: {
    toMarkdown: (block) => {
      const indent = "  ".repeat((block.props.indent as number) ?? 0);
      return `${indent}- ${block.content ?? ""}`;
    },
    toHTML: (block) => {
      // SEC5: alignment is serialized from a closed enum; content is serialized inline HTML.
      return `<li${textAlignmentStyle(block.props.textAlignment)}>${block.content ?? ""}</li>`;
    },
  },
});
