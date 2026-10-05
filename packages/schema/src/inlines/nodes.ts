import type { InlineSchema } from "@input/pen-types";
import { prop } from "@input/pen-core";
import { escapeHtml } from "../escapeHtml";
import { resolveProps } from "./resolveProps";

export const mention: InlineSchema = {
  type: "mention",
  propSchema: resolveProps({
    id: prop.string().default("").describe("Referenced entity ID"),
    label: prop.string().default("").describe("Display name"),
  }),
  kind: "node",
  serialize: {
    toMarkdown: (_, props) => `@${props?.label ?? ""}`,
    toHTML: (_, props) =>
      `<span class="mention" data-id="${escapeHtml(String(props?.id ?? ""))}">${escapeHtml(String(props?.label ?? ""))}</span>`,
  },
  aiDescription: "Mention of a user, page, or entity",
  a11y: {
    label: (props) => {
      const name =
        typeof props.label === "string" ? props.label.trim() : "";
      return name.length > 0 ? `@${name}` : "Mention";
    },
    roleDescription: "mention",
  },
};

export const inlineApp: InlineSchema = {
  type: "inlineApp",
  propSchema: resolveProps({
    appType: prop.string().default("").describe("App type identifier"),
    config: prop.json().describe("App configuration"),
  }),
  kind: "node",
  serialize: {
    toMarkdown: (_, props) => `[app:${props?.appType ?? ""}]`,
    toHTML: (_, props) =>
      `<span class="inline-app" data-type="${escapeHtml(String(props?.appType ?? ""))}"></span>`,
  },
  aiDescription: "Inline embedded application",
  a11y: {
    label: (props) => {
      const appType =
        typeof props.appType === "string" ? props.appType.trim() : "";
      return appType.length > 0 ? appType : "App";
    },
    roleDescription: "application",
  },
};
