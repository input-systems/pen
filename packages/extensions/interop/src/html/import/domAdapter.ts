import { parseDocument } from "htmlparser2";
import type { Document, Element, ChildNode } from "domhandler";

export interface DOMNode {
  type: string;
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, string>;
  children?: DOMNode[];
}

export function parseHTML(html: string): DOMNode {
  const doc = parseDocument(html);
  return htmlparser2ToDOMNode(doc);
}

function htmlparser2ToDOMNode(node: Document | ChildNode): DOMNode {
  if (node.type === "text") {
    return {
      type: "text",
      textContent: "data" in node ? String(node.data) : "",
    };
  }

  if (node.type === "tag" || node.type === "script" || node.type === "style") {
    const el = node as Element;
    return {
      type: "element",
      tagName: el.name.toLowerCase(),
      attributes: el.attribs ?? {},
      children: el.children?.map(htmlparser2ToDOMNode),
    };
  }

  if ("children" in node && Array.isArray(node.children)) {
    return {
      type: "root",
      children: node.children.map(htmlparser2ToDOMNode),
    };
  }

  return { type: "other" };
}
