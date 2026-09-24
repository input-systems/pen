import {
	defineBlock,
	prop,
} from "@input/pen-core";
import { directionProp } from "../directionProp";
import {
  textAlignmentProp,
  textAlignmentStyle,
} from "../textAlignmentProp";

export const heading = defineBlock("heading", {
  props: {
    level: prop.enum([1, 2, 3, 4, 5, 6]).default(1).describe("Heading level"),
    direction: directionProp,
    textAlignment: textAlignmentProp,
  },
  content: "inline",
  fieldEditor: "richtext",
  placeholder: "Heading",
  display: {
    title: "Heading",
    description: "Large section heading",
    group: "basic",
    aliases: ["h1", "h2", "h3", "h4", "h5", "h6", "title"],
  },
  serialize: {
    toMarkdown: (block) =>
      `${"#".repeat((block.props.level as number) ?? 1)} ${block.content ?? ""}`,
    toHTML: (block) => {
      const raw = Number(block.props.level);
      const level = raw >= 1 && raw <= 6 && Number.isInteger(raw) ? raw : 1;
      // SEC5: clamped heading level
      return `<h${level}${textAlignmentStyle(block.props.textAlignment)}>${block.content ?? ""}</h${level}>`;
    },
  },
  normalize: (block) => {
    const level = (block.props.level as number) ?? 1;
    if (level < 1 || level > 6) {
      return {
        ...block,
        props: {
          ...block.props,
          level: Math.max(1, Math.min(6, level as number)),
        },
      };
    }
    return block;
  },
});
