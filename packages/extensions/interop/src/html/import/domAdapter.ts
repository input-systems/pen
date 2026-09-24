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
  if (
    typeof Object.hasOwn !== "function" &&
    typeof globalThis.DOMParser !== "undefined"
  ) {
    const doc = new globalThis.DOMParser().parseFromString(html, "text/html");
    return {
      type: "root",
      children: Array.from(doc.body.childNodes).map(domNodeToDOMNode),
    };
  }

  const doc = parseDocument(html);
  return htmlparser2ToDOMNode(doc);
}

function domNodeToDOMNode(node: globalThis.Node): DOMNode {
  const result: DOMNode = {
    type:
      node.nodeType === 1
        ? "element"
        : node.nodeType === 3
          ? "text"
          : "other",
  };

  if (node.nodeType === 1) {
    const el = node as globalThis.Element;
    result.tagName = el.tagName.toLowerCase();
    result.attributes = {};
    for (const attr of el.attributes) {
      result.attributes[attr.name.toLowerCase()] = attr.value;
    }
  }

  if (node.nodeType === 3) {
    result.textContent = node.textContent ?? "";
  }

  if (node.childNodes.length > 0) {
    result.children = Array.from(node.childNodes).map(domNodeToDOMNode);
  }

  return result;
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
