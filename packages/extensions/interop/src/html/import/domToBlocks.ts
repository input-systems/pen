import type { DOMNode } from "./domAdapter";
import { parseInlineContent } from "./inlineParser";
import { parseSafeStyleDeclarations } from "./sanitize";
import type {
  BlockImportMatch,
  HTMLImportElement,
  HTMLImportNode,
  SchemaRegistry,
} from "@input/pen-types";
import type { PendingBlock } from "@input/pen-core";

const BLOCK_ELEMENT_MAP: Record<string, (node: DOMNode) => PendingBlock> = {
  h1: (node) =>
    blockWithInline("heading", propsWithTextAlignment(node, { level: 1 }), node),
  h2: (node) =>
    blockWithInline("heading", propsWithTextAlignment(node, { level: 2 }), node),
  h3: (node) =>
    blockWithInline("heading", propsWithTextAlignment(node, { level: 3 }), node),
  h4: (node) =>
    blockWithInline("heading", propsWithTextAlignment(node, { level: 4 }), node),
  h5: (node) =>
    blockWithInline("heading", propsWithTextAlignment(node, { level: 5 }), node),
  h6: (node) =>
    blockWithInline("heading", propsWithTextAlignment(node, { level: 6 }), node),
  p: (node) => blockWithInline("paragraph", propsWithTextAlignment(node), node),
  blockquote: (node) =>
    blockWithInline("blockquote", propsWithTextAlignment(node), node),
  hr: () => ({ type: "divider", props: {} }),
  pre: (node) => {
    const codeNode = node.children?.find((c) => c.tagName === "code");
    const langClass = codeNode?.attributes?.class ?? "";
    const langMatch = langClass.match(/language-(\S+)/);
    const text = extractText(codeNode ?? node);
    return {
      type: "codeBlock",
      props: { language: langMatch?.[1] ?? undefined },
      content: text,
    };
  },
  img: (node) => ({
    type: "image",
    props: {
      src: node.attributes?.src ?? "",
      alt: node.attributes?.alt ?? undefined,
      caption: node.attributes?.title ?? undefined,
    },
  }),
};

export function domToBlocks(
  root: DOMNode,
  registry: SchemaRegistry,
): PendingBlock[] {
  const blocks: PendingBlock[] = [];
  walkElements(root, blocks, registry);
  return blocks;
}

function walkElements(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
): void {
  if (node.type === "text") {
    const text = (node.textContent ?? "").trim();
    if (text) {
      blocks.push({ type: "paragraph", props: {}, content: text });
    }
    return;
  }

  if (node.type !== "element" || !node.tagName) {
    for (const child of node.children ?? []) {
      walkElements(child, blocks, registry);
    }
    return;
  }

  const schemaBlock = resolveFromHTMLSchema(node, registry);
  if (schemaBlock) {
    const consumed = findConsumedChild(node, schemaBlock);
    const nested: PendingBlock[] = [];
    for (const child of node.children ?? []) {
      if (child === consumed) {
        continue;
      }
      if (isBlockishChild(child)) {
        walkElements(child, nested, registry);
      }
    }
    if (schemaBlock.content === undefined) {
      const inlineFallback =
        nested.length > 0 && !consumed ? inlineOnlyClone(node) : node;
      const inlineSource = getHtmlInlineSource(schemaBlock, inlineFallback);
      if (inlineSource) {
        const inline = parseInlineContent(inlineSource);
        schemaBlock.content = inline.text;
        schemaBlock.marks = inline.marks;
      }
    }
    if (nested.length > 0) {
      schemaBlock.children = [...(schemaBlock.children ?? []), ...nested];
    }
    blocks.push(schemaBlock);
    return;
  }

  const handler = BLOCK_ELEMENT_MAP[node.tagName];
  if (handler) {
    blocks.push(handler(node));
    return;
  }

  if (node.tagName === "ul" || node.tagName === "ol") {
    walkList(node, blocks, registry, 0, node.tagName === "ol");
    return;
  }

  if (node.tagName === "table") {
    blocks.push(parseHTMLTable(node));
    return;
  }

  if (isBlockElement(node.tagName)) {
    for (const child of node.children ?? []) {
      walkElements(child, blocks, registry);
    }
    return;
  }

  const inline = parseInlineContent(node);
  if (inline.text.trim()) {
    blocks.push({
      type: "paragraph",
      props: {},
      content: inline.text,
      marks: inline.marks,
    });
  }
}

function walkList(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  indent: number,
  ordered: boolean,
): void {
  const items = (node.children ?? []).filter((c) => c.tagName === "li");
  const olStart = ordered ? parseOlStart(node) : undefined;
  const listAlignment = textAlignment(node);

  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const li = items[itemIdx];
    const checkbox = li.children?.find(
      (c) =>
        c.tagName === "input" && c.attributes?.type === "checkbox",
    );

    const inlineChildren = (li.children ?? []).filter(
      (c) =>
        c.tagName !== "ul" &&
        c.tagName !== "ol" &&
        !(c.tagName === "input" && c.attributes?.type === "checkbox"),
    );
    const inline = parseInlineContent({
      type: "element",
      tagName: "span",
      children: inlineChildren,
    });

    if (checkbox) {
      blocks.push({
        type: "checkListItem",
        props: {
          indent,
          checked: checkbox.attributes?.checked !== undefined,
          ...textAlignmentProps(li, listAlignment),
        },
        content: inline.text,
        marks: inline.marks,
      });
    } else if (ordered) {
      blocks.push({
        type: "numberedListItem",
        props: {
          indent,
          start: itemIdx === 0 ? olStart : undefined,
          ...textAlignmentProps(li, listAlignment),
        },
        content: inline.text,
        marks: inline.marks,
      });
    } else {
      blocks.push({
        type: "bulletListItem",
        props: { indent, ...textAlignmentProps(li, listAlignment) },
        content: inline.text,
        marks: inline.marks,
      });
    }

    for (const child of li.children ?? []) {
      if (child.tagName === "ul" || child.tagName === "ol") {
        walkList(child, blocks, registry, indent + 1, child.tagName === "ol");
      }
    }
  }
}

function parseOlStart(node: DOMNode): number | undefined {
  const raw = node.attributes?.start;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseHTMLTable(node: DOMNode): PendingBlock {
  const hasHeaderRow = (node.children ?? []).some(
    (c) => c.tagName === "thead",
  );

  const rows: PendingBlock[] = [];
  const allRows = collectTableRows(node);
  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const row = allRows[rowIdx];
    const cells: PendingBlock[] = [];
    const cellNodes = (row.children ?? []).filter(
      (c) => c.tagName === "td" || c.tagName === "th",
    );
    for (let colIdx = 0; colIdx < cellNodes.length; colIdx++) {
      const inline = parseInlineContent(cellNodes[colIdx]);
      cells.push({
        type: "__table_cell",
        props: { _rowIndex: rowIdx, _colIndex: colIdx },
        content: inline.text,
        marks: inline.marks,
      });
    }
    rows.push({
      type: "__table_row",
      props: { _rowIndex: rowIdx },
      children: cells,
    });
  }

  return {
    type: "table",
    props: { hasHeaderRow, hasHeaderColumn: false },
    children: rows,
  };
}

function collectTableRows(tableNode: DOMNode): DOMNode[] {
  const rows: DOMNode[] = [];
  for (const child of tableNode.children ?? []) {
    if (child.tagName === "tr") {
      rows.push(child);
    } else if (
      child.tagName === "thead" ||
      child.tagName === "tbody" ||
      child.tagName === "tfoot"
    ) {
      for (const row of child.children ?? []) {
        if (row.tagName === "tr") rows.push(row);
      }
    }
  }
  return rows;
}

function blockWithInline(
  type: string,
  props: Record<string, unknown>,
  node: DOMNode,
): PendingBlock {
  const inline = parseInlineContent(node);
  return { type, props, content: inline.text, marks: inline.marks };
}

const TEXT_ALIGNMENTS = new Set([
  "left",
  "right",
  "center",
  "justify",
  "start",
  "end",
]);

function propsWithTextAlignment(
  node: DOMNode,
  props: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...props, ...textAlignmentProps(node) };
}

function textAlignmentProps(
  node: DOMNode,
  inherited?: string,
): Record<string, unknown> {
  const alignment = textAlignment(node) ?? inherited;
  return alignment ? { textAlignment: alignment } : {};
}

function textAlignment(node: DOMNode): string | undefined {
  let alignment = node.attributes?.align?.toLowerCase();
  for (const declaration of parseSafeStyleDeclarations(
    node.attributes?.style ?? "",
  )) {
    if (declaration.property === "text-align") {
      alignment = declaration.value;
    }
  }
  return alignment && TEXT_ALIGNMENTS.has(alignment) ? alignment : undefined;
}

function extractText(node: DOMNode): string {
  if (node.type === "text") return node.textContent ?? "";
  return (node.children ?? []).map(extractText).join("");
}

const BLOCK_ELEMENTS = new Set([
  "div",
  "section",
  "article",
  "main",
  "aside",
  "header",
  "footer",
  "nav",
  "figure",
  "figcaption",
  "fieldset",
  "legend",
  "address",
  "hgroup",
]);

function isBlockElement(tagName: string): boolean {
  return BLOCK_ELEMENTS.has(tagName);
}

function resolveFromHTMLSchema(
  node: DOMNode,
  registry: SchemaRegistry,
): BlockImportMatch | null {
  if (!registry.resolve) return null;
  const blockSchemas = registry.allBlocks?.() ?? [];
  const htmlElement = toHTMLImportElement(node);
  for (const schema of blockSchemas) {
    if (schema.serialize?.fromHTML && htmlElement) {
      const result = schema.serialize.fromHTML(htmlElement);
      if (result) return result;
    }
  }
  return null;
}

function toHTMLImportElement(node: DOMNode): HTMLImportElement | null {
  if (node.type !== "element" || !node.tagName) {
    return null;
  }
  const attributes = { ...(node.attributes ?? {}) };
  const children = (node.children ?? [])
    .map(toHTMLImportNode)
    .filter((child): child is HTMLImportNode => child !== null);
  return {
    type: "element",
    tagName: node.tagName,
    attributes,
    children,
    textContent: node.textContent,
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    },
  };
}

function toHTMLImportNode(node: DOMNode): HTMLImportNode | null {
  if (node.type === "text") {
    return {
      type: "text",
      textContent: node.textContent ?? "",
    };
  }
  return toHTMLImportElement(node);
}

function findConsumedChild(
  node: DOMNode,
  block: BlockImportMatch,
): DOMNode | null {
  const source = block.importContentSource?.htmlElement;
  if (!source) {
    return null;
  }
  return (
    (node.children ?? []).find(
      (child) =>
        child.type === "element" && child.tagName === source.tagName,
    ) ?? null
  );
}

function isBlockishChild(child: DOMNode): boolean {
  if (child.type !== "element" || !child.tagName) {
    return false;
  }
  if (BLOCK_ELEMENT_MAP[child.tagName]) {
    return true;
  }
  if (
    child.tagName === "ul" ||
    child.tagName === "ol" ||
    child.tagName === "table" ||
    child.tagName === "details"
  ) {
    return true;
  }
  return isBlockElement(child.tagName);
}

function inlineOnlyClone(node: DOMNode): DOMNode {
  return {
    ...node,
    children: (node.children ?? []).filter((child) => !isBlockishChild(child)),
  };
}

function getHtmlInlineSource(
  block: BlockImportMatch,
  fallbackNode: DOMNode,
): DOMNode | null {
  if (block.type === "codeBlock" || block.type === "table") {
    return null;
  }

  const explicitSource = block.importContentSource?.htmlElement;
  if (explicitSource) {
    return explicitSource as unknown as DOMNode;
  }

  if (block.content === undefined) {
    return fallbackNode;
  }

  return null;
}
