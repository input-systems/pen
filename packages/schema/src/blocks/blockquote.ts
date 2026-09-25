import {
	defineBlock,
	prop,
} from "@input/pen-core";
import { directionProp } from "../directionProp";
import {
  textAlignmentProp,
  textAlignmentStyle,
} from "../textAlignmentProp";

export const blockquote = defineBlock("blockquote", {
  props: {
    parentId: prop.string().optional().describe("Container parent block"),
    direction: directionProp,
    textAlignment: textAlignmentProp,
  },
  content: "inline",
  fieldEditor: "richtext",
  isContainer: true,
  display: {
    title: "Quote",
    description: "Block quotation",
    group: "basic",
    aliases: ["quote", "blockquote", "pullquote"],
  },
  serialize: {
    toMarkdown: (block) => `> ${block.content ?? ""}`,
    toHTML: (block) => {
      // SEC5: alignment is serialized from a closed enum; content is serialized inline HTML.
      return `<blockquote${textAlignmentStyle(block.props.textAlignment)}>${block.content ?? ""}</blockquote>`;
    },
  },
});
