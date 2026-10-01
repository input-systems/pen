import type { DOMNode } from "./domAdapter";
import { containsBreak, parseInlineContent, parseInlineLines } from "./inlineParser";
import { parseSafeStyleDeclarations } from "./sanitize";
import type {
  BlockImportMatch,
  HTMLImportElement,
  HTMLImportNode,
  SchemaRegistry,
} from "@input/pen-types";
import type { PendingBlock } from "@input/pen-core";

const BLOCK_ELEMENT_MAP: Record<
  string,
  (node: DOMNode, ancestors: readonly DOMNode[]) => PendingBlock
> = {
  h1: (node, ancestors) =>
    blockWithInline(
      "heading",
      propsWithTextAlignment(node, { level: 1 }),
      node,
      ancestors,
    ),
  h2: (node, ancestors) =>
    blockWithInline(
      "heading",
      propsWithTextAlignment(node, { level: 2 }),
      node,
      ancestors,
    ),
  h3: (node, ancestors) =>
    blockWithInline(
      "heading",
      propsWithTextAlignment(node, { level: 3 }),
      node,
      ancestors,
    ),
  h4: (node, ancestors) =>
    blockWithInline(
      "heading",
      propsWithTextAlignment(node, { level: 4 }),
      node,
      ancestors,
    ),
  h5: (node, ancestors) =>
    blockWithInline(
      "heading",
      propsWithTextAlignment(node, { level: 5 }),
      node,
      ancestors,
    ),
  h6: (node, ancestors) =>
    blockWithInline(
      "heading",
      propsWithTextAlignment(node, { level: 6 }),
      node,
      ancestors,
    ),
  p: (node, ancestors) =>
    blockWithInline("paragraph", propsWithTextAlignment(node), node, ancestors),
  blockquote: (node, ancestors) =>
    blockWithInline(
      "blockquote",
      propsWithTextAlignment(node),
      node,
      ancestors,
    ),
  hr: () => ({ type: "divider", props: {} }),
  pre: (node) => {
    const codeNode = node.children?.find((c) => c.tagName === "code");
    const langClass = codeNode?.attributes?.class ?? "";
    const langMatch = langClass.match(/language-(\S+)/);
    const text = extractText(node);
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
  const claims: SchemaClaims = { nodes: new Set(), blocks: new Set() };
  walkElements(root, blocks, registry, claims, []);
  // IOP11: a conversion that would drop text imports the fragment as plain lines
  return keepsAllText(root, blocks, claims) ? blocks : plainLineBlocks(root);
}

// Only an opaque schema result owns its complete text representation. Sources
// parsed by this converter and container children remain subject to IOP11.
interface SchemaClaims {
  nodes: Set<DOMNode>;
  blocks: Set<PendingBlock>;
}

function walkElements(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  claims: SchemaClaims,
  ancestors: readonly DOMNode[],
): void {
  if (node.type === "text") {
    const text = (node.textContent ?? "").trim();
    if (text) {
      blocks.push({ type: "paragraph", props: {}, content: text });
    }
    return;
  }

  if (node.type !== "element" || !node.tagName) {
    walkBlockContainer(node, blocks, registry, claims, ancestors);
    return;
  }

  const schemaBlock = resolveFromHTMLSchema(node, registry);
  if (schemaBlock) {
    const consumed = findConsumedChild(node, schemaBlock);
    const isContainer =
      registry.resolve(schemaBlock.type)?.isContainer === true;
    if (
      schemaBlock.content !== undefined &&
      !schemaBlock.importContentSource?.htmlElement &&
      !isContainer
    ) {
      claims.nodes.add(node);
      claims.blocks.add(schemaBlock);
    }
    const nested: PendingBlock[] = [];
    if (consumed) {
      // Only the declared content source belongs to the block's title. Read
      // every other child as body content, including inline runs on either side.
      const children = node.children ?? [];
      const index = children.indexOf(consumed);
      for (const run of [children.slice(0, index), children.slice(index + 1)]) {
        walkBlockContainer(
          { ...node, children: run },
          nested,
          registry,
          claims,
          ancestors,
        );
      }
    } else if (isContainer && schemaBlock.content === "") {
      walkBlockContainer(node, nested, registry, claims, ancestors);
    } else {
      for (const child of node.children ?? []) {
        if (isBlockishChild(child)) {
          walkElements(child, nested, registry, claims, [...ancestors, node]);
        }
      }
    }
    if (schemaBlock.content === undefined) {
      const inlineFallback =
        nested.length > 0 && !consumed ? inlineOnlyClone(node) : node;
      const inlineSource = getHtmlInlineSource(schemaBlock, inlineFallback);
      if (inlineSource) {
        const inline = parseInlineContent(
          inlineSource,
          consumed ? [...ancestors, node] : ancestors,
        );
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
    blocks.push(handler(node, ancestors));
    return;
  }

  if (node.tagName === "ul" || node.tagName === "ol") {
    walkList(
      node,
      blocks,
      registry,
      claims,
      0,
      node.tagName === "ol",
      ancestors,
    );
    return;
  }

  // an item copied without its list
  if (node.tagName === "li") {
    walkListItem(
      node,
      blocks,
      registry,
      claims,
      { indent: 0, ordered: false },
      ancestors,
    );
    return;
  }

  if (node.tagName === "table") {
    // a caption, or text the source left outside the rows, has no cell to land in
    const outsideRows = paragraphFromInlineRun(
      (node.children ?? []).filter(
        (child) => !TABLE_STRUCTURE_ELEMENTS.has(child.tagName ?? ""),
      ),
      false,
      [...ancestors, node],
    );
    if (outsideRows) blocks.push(outsideRows);
    blocks.push(parseHTMLTable(node, ancestors));
    return;
  }

  if (isBlockElement(node.tagName)) {
    walkBlockContainer(node, blocks, registry, claims, ancestors);
    return;
  }

  // google docs wraps a whole copy in `<b>`: an inline wrapper around blocks is a
  // container whose marks apply to each line inside it
  if ((node.children ?? []).some(containsLineBlock)) {
    walkBlockContainer(node, blocks, registry, claims, ancestors);
    return;
  }

  const inline = parseInlineContent(node, ancestors);
  if (inline.text.trim()) {
    blocks.push({
      type: "paragraph",
      props: {},
      content: inline.text,
      marks: inline.marks,
    });
  }
}

// an image sits in a line of text; every other block breaks the line
function containsLineBlock(node: DOMNode): boolean {
  return (
    (isBlockishChild(node) && node.tagName !== "img") ||
    (node.children ?? []).some(containsLineBlock)
  );
}

interface ListItemContext {
  indent: number;
  ordered: boolean;
  start?: number;
  listAlignment?: string;
}

// slack, apple notes and google docs nest a list as a child of the list itself
// rather than of an item, so every child is read, not only `<li>`
function walkList(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  claims: SchemaClaims,
  indent: number,
  ordered: boolean,
  ancestors: readonly DOMNode[],
): void {
  const olStart = ordered ? parseOlStart(node) : undefined;
  const listAlignment = textAlignment(node);
  const listAncestors = [...ancestors, node];
  let hasOwnItem = false;
  const appendItem = (li: DOMNode) => {
    const emitted = walkListItem(
      li,
      blocks,
      registry,
      claims,
      {
        indent,
        ordered,
        start: hasOwnItem ? undefined : olStart,
        listAlignment,
      },
      listAncestors,
    );
    hasOwnItem ||= emitted;
  };

  // text placed between items has no item of its own; it stays as one
  let stray: DOMNode[] = [];
  const flushStray = () => {
    const strayItem: DOMNode = {
      type: "element",
      tagName: "li",
      children: stray,
    };
    stray = [];
    if (listItemInline(strayItem, listAncestors).text.trim()) {
      appendItem(strayItem);
    }
  };

  for (const child of node.children ?? []) {
    if (child.tagName === "li") {
      flushStray();
      appendItem(child);
    } else if (child.tagName === "ul" || child.tagName === "ol") {
      flushStray();
      walkList(
        child,
        blocks,
        registry,
        claims,
        indent + 1,
        child.tagName === "ol",
        listAncestors,
      );
    } else if (containsBlockish(child)) {
      flushStray();
      walkElements(child, blocks, registry, claims, listAncestors);
    } else {
      stray.push(child);
    }
  }
  flushStray();
}

function isNestedList(node: DOMNode): boolean {
  return node.tagName === "ul" || node.tagName === "ol";
}

function isCheckbox(node: DOMNode): boolean {
  return node.tagName === "input" && node.attributes?.type === "checkbox";
}

// an item's block children are separate lines of the one item
function listItemInline(
  li: DOMNode,
  ancestors: readonly DOMNode[],
): ReturnType<typeof parseInlineContent> {
  const lines: DOMNode[] = [];
  let run: DOMNode[] = [];
  let hasContent = false;
  let afterBlock = false;
  for (const child of li.children ?? []) {
    if (isNestedList(child) || isCheckbox(child)) continue;
    if (child.type === "text" && !(child.textContent ?? "").trim()) {
      run.push(child);
      continue;
    }
    const isBlock = isBlockishChild(child) && child.tagName !== "img";
    if (hasContent && (isBlock || afterBlock)) {
      lines.push(inlineRunSource(run));
      run = [];
    }
    run.push(child);
    hasContent = true;
    afterBlock = isBlock;
  }
  lines.push(inlineRunSource(run));
  return parseInlineLines(lines, [...ancestors, li]);
}

function walkListItem(
  li: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  claims: SchemaClaims,
  context: ListItemContext,
  ancestors: readonly DOMNode[],
): boolean {
  const lengthBefore = blocks.length;
  const { indent, ordered, start, listAlignment } = context;
  const checkbox = li.children?.find(isCheckbox);
  const nestedLists = (li.children ?? []).filter(isNestedList);
  const inline = listItemInline(li, ancestors);
  const alignment = textAlignmentProps(li, listAlignment);

  if (checkbox) {
    blocks.push({
      type: "checkListItem",
      props: {
        indent,
        checked: checkbox.attributes?.checked !== undefined,
        ...alignment,
      },
      content: inline.text,
      marks: inline.marks,
    });
  } else if (inline.text === "" && nestedLists.length > 0) {
    // an item that only wraps a nested list carries no line of its own
  } else if (ordered) {
    blocks.push({
      type: "numberedListItem",
      props: { indent, start, ...alignment },
      content: inline.text,
      marks: inline.marks,
    });
  } else {
    blocks.push({
      type: "bulletListItem",
      props: { indent, ...alignment },
      content: inline.text,
      marks: inline.marks,
    });
  }

  const emittedOwnItem = blocks.length > lengthBefore;
  for (const child of nestedLists) {
    walkList(
      child,
      blocks,
      registry,
      claims,
      indent + 1,
      child.tagName === "ol",
      [...ancestors, li],
    );
  }
  return emittedOwnItem;
}

function parseOlStart(node: DOMNode): number | undefined {
  const raw = node.attributes?.start;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseHTMLTable(
  node: DOMNode,
  ancestors: readonly DOMNode[],
): PendingBlock {
  const hasHeaderRow = (node.children ?? []).some((c) => c.tagName === "thead");

  const rows: PendingBlock[] = [];
  const allRows = collectTableRows(node);
  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const { row, section } = allRows[rowIdx];
    const cells: PendingBlock[] = [];
    const cellNodes = (row.children ?? []).filter(
      (c) => c.tagName === "td" || c.tagName === "th",
    );
    for (let colIdx = 0; colIdx < cellNodes.length; colIdx++) {
      const inline = parseInlineContent(cellNodes[colIdx], [
        ...ancestors,
        node,
        ...(section ? [section] : []),
        row,
      ]);
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

const TABLE_STRUCTURE_ELEMENTS = new Set([
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "colgroup",
  "col",
]);

function collectTableRows(
  tableNode: DOMNode,
): Array<{ row: DOMNode; section?: DOMNode }> {
  const rows: Array<{ row: DOMNode; section?: DOMNode }> = [];
  for (const child of tableNode.children ?? []) {
    if (child.tagName === "tr") {
      rows.push({ row: child });
    } else if (
      child.tagName === "thead" ||
      child.tagName === "tbody" ||
      child.tagName === "tfoot"
    ) {
      for (const row of child.children ?? []) {
        if (row.tagName === "tr") rows.push({ row, section: child });
      }
    }
  }
  return rows;
}

function blockWithInline(
  type: string,
  props: Record<string, unknown>,
  node: DOMNode,
  ancestors: readonly DOMNode[],
): PendingBlock {
  const inline = parseInlineContent(node, ancestors);
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

// a container's inline children between two block children are one line box in
// the source, so they import as one paragraph: text, marks and `<br>` together
function walkBlockContainer(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  claims: SchemaClaims,
  ancestors: readonly DOMNode[],
): void {
  // a break between top-level blocks is clipboard residue, not a blank line
  const keepsPlaceholderBreak = node.type === "element";
  const childAncestors = keepsPlaceholderBreak
    ? [...ancestors, node]
    : ancestors;
  let run: DOMNode[] = [];
  const flushRun = () => {
    const paragraph = paragraphFromInlineRun(
      run,
      keepsPlaceholderBreak,
      childAncestors,
    );
    if (paragraph) blocks.push(paragraph);
    run = [];
  };
  for (const child of node.children ?? []) {
    if (importsAsOwnBlock(child, registry)) {
      flushRun();
      walkElements(child, blocks, registry, claims, childAncestors);
    } else {
      run.push(child);
    }
  }
  flushRun();
}

function importsAsOwnBlock(child: DOMNode, registry: SchemaRegistry): boolean {
  return (
    containsBlockish(child) || resolveFromHTMLSchema(child, registry) !== null
  );
}

function containsBlockish(node: DOMNode): boolean {
  return isBlockishChild(node) || (node.children ?? []).some(containsBlockish);
}

// whitespace that includes a line break is source formatting, which html renders
// as at most one space. plain spaces stay: the sanitizer drops `white-space`, so
// they cannot be told apart from code indentation
const FORMATTING_WHITESPACE = /[ \t]*[\n\r\f][ \t\n\r\f]*/g;
const FORMATTING_GAP = "\u0000";
const FORMATTING_GAPS = new RegExp(`${FORMATTING_GAP}+`, "g");

function markFormattingWhitespace(node: DOMNode): DOMNode {
  if (node.type === "text") {
    return {
      ...node,
      textContent: (node.textContent ?? "").replace(
        FORMATTING_WHITESPACE,
        FORMATTING_GAP,
      ),
    };
  }
  return node.children
    ? { ...node, children: node.children.map(markFormattingWhitespace) }
    : node;
}

// a container's own text is trimmed at the edges of its line, as it was when
// each text child was a paragraph; spaces inside an inline element are content
function trimRunEdges(run: DOMNode[]): DOMNode[] {
  return run.map((child, index) => {
    if (child.type !== "text") return child;
    let text = child.textContent ?? "";
    if (index === 0) text = text.replace(/^[ \t\n\r\f]+/, "");
    if (index === run.length - 1) text = text.replace(/[ \t\n\r\f]+$/, "");
    return { ...child, textContent: text };
  });
}

function collectInlineLeaves(node: DOMNode, leaves: DOMNode[]): void {
  if (node.type === "text" || node.tagName === "br") {
    leaves.push(node);
    return;
  }
  for (const child of node.children ?? []) {
    collectInlineLeaves(child, leaves);
  }
}

// a formatting gap paints one space, and none at a line edge or beside a space
function resolveFormattingGaps(source: DOMNode): void {
  const leaves: DOMNode[] = [];
  collectInlineLeaves(source, leaves);
  const leafText = (leaf: DOMNode) =>
    leaf.type === "text" ? (leaf.textContent ?? "") : "\n";
  const line = leaves.map(leafText).join("");
  const isLineEdgeOrSpace = (char: string | undefined) =>
    char === undefined || char === "\n" || char === " ";
  const resolved = line.replace(FORMATTING_GAPS, (gaps, offset: number) => {
    const paints =
      !isLineEdgeOrSpace(line[offset - 1]) &&
      !isLineEdgeOrSpace(line[offset + gaps.length]);
    return (paints ? " " : FORMATTING_GAP) + gaps.slice(1);
  });

  let offset = 0;
  for (const leaf of leaves) {
    const end = offset + leafText(leaf).length;
    if (leaf.type === "text") {
      leaf.textContent = resolved
        .slice(offset, end)
        .split(FORMATTING_GAP)
        .join("");
    }
    offset = end;
  }
}

function inlineRunSource(run: DOMNode[]): DOMNode {
  const source: DOMNode = {
    type: "root",
    children: trimRunEdges(run).map(markFormattingWhitespace),
  };
  resolveFormattingGaps(source);
  return source;
}

function paragraphFromInlineRun(
  run: DOMNode[],
  keepsPlaceholderBreak: boolean,
  ancestors: readonly DOMNode[],
): PendingBlock | null {
  const source = inlineRunSource(run);
  const inline = parseInlineContent(source, ancestors);

  // residue is dropped however many breaks it holds: only the last one is the
  // line terminator `parseInlineContent` removes
  if (!keepsPlaceholderBreak && /^[ \n]*$/.test(inline.text)) return null;

  // gmail and apple mail write a blank line as `<div><br></div>`; the break is the
  // container's empty placeholder (EM8), the same as a paragraph's sole `<br>`
  if (/^ *$/.test(inline.text)) {
    return keepsPlaceholderBreak && containsBreak(source)
      ? { type: "paragraph", props: {}, content: "" }
      : null;
  }

  return {
    type: "paragraph",
    props: {},
    content: inline.text,
    marks: inline.marks,
  };
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
      (child) => child.type === "element" && child.tagName === source.tagName,
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
    child.tagName === "li" ||
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

const LINE_ELEMENTS = new Set(["p", "li", "tr", "pre", "blockquote", "br"]);

function isLineBoundary(node: DOMNode): boolean {
  return (
    node.type === "element" &&
    !!node.tagName &&
    (isBlockishChild(node) || LINE_ELEMENTS.has(node.tagName))
  );
}

function collectPlainLines(node: DOMNode, lines: string[]): void {
  if (node.type === "text") {
    lines[lines.length - 1] += node.textContent ?? "";
    return;
  }
  const boundary = isLineBoundary(node);
  const cell = node.tagName === "td" || node.tagName === "th";
  if (boundary) lines.push("");
  if (cell) lines[lines.length - 1] += " ";
  for (const child of node.children ?? []) {
    collectPlainLines(child, lines);
  }
  if (cell) lines[lines.length - 1] += " ";
  if (boundary) lines.push("");
}

// the fragment's text, one paragraph per source line and nothing else
function plainLineBlocks(root: DOMNode): PendingBlock[] {
  const lines = [""];
  collectPlainLines(root, lines);
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ type: "paragraph", props: {}, content: line }));
}

function inkLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function domInkLength(node: DOMNode, claims: SchemaClaims): number {
  if (claims.nodes.has(node)) return 0;
  if (node.type === "text") return inkLength(node.textContent ?? "");
  let length = 0;
  for (const child of node.children ?? []) {
    length += domInkLength(child, claims);
  }
  return length;
}

function blocksInkLength(
  blocks: readonly PendingBlock[],
  claims: SchemaClaims,
): number {
  let length = 0;
  for (const block of blocks) {
    if (claims.blocks.has(block)) continue;
    length += inkLength(block.content ?? "");
    length += blocksInkLength(block.children ?? [], claims);
  }
  return length;
}

// whitespace is layout the conversion may rewrite; every other character of the
// source has to reach a block
function keepsAllText(
  root: DOMNode,
  blocks: readonly PendingBlock[],
  claims: SchemaClaims,
): boolean {
  return blocksInkLength(blocks, claims) >= domInkLength(root, claims);
}
