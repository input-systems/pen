import type { InlineSchema } from "@input/pen-types";
import { prop } from "@input/pen-core";
import { escapeHtml } from "../escapeHtml";
import { resolveProps } from "./resolveProps";

export const bold: InlineSchema = {
  type: "bold",
  propSchema: {},
  kind: "mark",
  expand: "after",
  priority: 100,
  serialize: {
    toMarkdown: (text) => `**${text}**`,
    toHTML: (text) => `<strong>${text}</strong>`,
  },
  aiDescription: "Bold text formatting",
};

export const italic: InlineSchema = {
  type: "italic",
  propSchema: {},
  kind: "mark",
  expand: "after",
  priority: 200,
  serialize: {
    toMarkdown: (text) => `*${text}*`,
    toHTML: (text) => `<em>${text}</em>`,
  },
  aiDescription: "Italic text formatting",
};

export const underline: InlineSchema = {
  type: "underline",
  propSchema: {},
  kind: "mark",
  expand: "after",
  priority: 300,
  serialize: {
    toMarkdown: (text) => `<u>${text}</u>`,
    toHTML: (text) => `<u>${text}</u>`,
  },
  aiDescription: "Underlined text",
};

export const strikethrough: InlineSchema = {
  type: "strikethrough",
  propSchema: {},
  kind: "mark",
  expand: "after",
  priority: 400,
  serialize: {
    toMarkdown: (text) => `~~${text}~~`,
    toHTML: (text) => `<s>${text}</s>`,
  },
  aiDescription: "Strikethrough text",
};

export const highlight: InlineSchema = {
  type: "highlight",
  propSchema: resolveProps({
    color: prop.string().default("yellow").describe("Highlight color"),
  }),
  kind: "mark",
  expand: "after",
  priority: 500,
  serialize: {
    toMarkdown: (text) => `==${text}==`,
    toHTML: (text, props) =>
      `<mark style="background-color: ${escapeHtml(String(props?.color ?? "yellow"))}">${text}</mark>`,
  },
  aiDescription: "Highlighted text with configurable color",
};

export const textColor: InlineSchema = {
  type: "textColor",
  propSchema: resolveProps({
    color: prop.string().default("").describe("CSS color value"),
  }),
  kind: "mark",
  expand: "after",
  priority: 600,
  serialize: {
    toMarkdown: (text) => text,
    toHTML: (text, props) =>
      `<span style="color: ${escapeHtml(String(props?.color ?? "inherit"))}">${text}</span>`,
  },
  aiDescription: "Colored text",
};

export const backgroundColor: InlineSchema = {
  type: "backgroundColor",
  propSchema: resolveProps({
    color: prop.string().default("").describe("CSS background-color value"),
  }),
  kind: "mark",
  expand: "after",
  priority: 700,
  serialize: {
    toMarkdown: (text) => text,
    toHTML: (text, props) =>
      `<span style="background-color: ${escapeHtml(String(props?.color ?? "transparent"))}">${text}</span>`,
  },
  aiDescription: "Text with background color",
};

export const link: InlineSchema = {
  type: "link",
  propSchema: resolveProps({
    href: prop.string().default("").describe("Link URL"),
    title: prop.string().optional().describe("Link title attribute"),
  }),
  kind: "mark",
  expand: "none",
  priority: 800,
  serialize: {
    toMarkdown: (text, props) => {
      const title = props?.title ? ` "${props.title}"` : "";
      return `[${text}](${props?.href ?? ""}${title})`;
    },
    toHTML: (text, props) => {
      const title = props?.title
        ? ` title="${escapeHtml(String(props.title))}"`
        : "";
      return `<a href="${escapeHtml(String(props?.href ?? ""))}"${title}>${text}</a>`;
    },
  },
  aiDescription: "Hyperlink with URL and optional title",
};

export const code: InlineSchema = {
  type: "code",
  propSchema: {},
  kind: "mark",
  expand: "none",
  priority: 900,
  serialize: {
    toMarkdown: (text) => `\`${text}\``,
    toHTML: (text) => `<code>${text}</code>`,
  },
  aiDescription: "Inline code span",
};
