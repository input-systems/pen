import type { BlockImportMatch, MarkdownNode, SchemaRegistry } from "@input/pen-types";
import { pendingBlocksFromHtmlFragment } from "./htmlBlocks";
import { collectInlineHtmlContent } from "./htmlInline";
import { collectInlineContent, processInlineNodes } from "./inlineMarks";
import { parseTable } from "./tableParser";
import type {
  InlineMark,
  MdastList,
  MdastListItem,
  MdastNode,
  MdastRoot,
  MdastTable,
  PendingBlock,
} from "./markdownTypes";

const blockMappings: Record<
  string,
  (node: MdastNode) => PendingBlock | null
> = {
  heading: (node) => ({
    type: "heading",
    props: { level: node.depth ?? 1 },
    content: "",
    marks: [],
  }),

  paragraph: () => ({
    type: "paragraph",
    props: {},
    content: "",
    marks: [],
  }),

  blockquote: () => ({
    type: "blockquote",
    props: {},
    content: "",
    marks: [],
  }),

  code: (node) => ({
    type: "codeBlock",
    props: { language: node.lang ?? undefined },
    content: node.value ?? "",
    marks: [],
  }),

  thematicBreak: () => ({
    type: "divider",
    props: {},
  }),

  image: (node) => ({
    type: "image",
    props: {
      src: node.url ?? "",
      alt: node.alt ?? undefined,
      caption: node.title ?? undefined,
    },
  }),

  table: (node) => parseTable(node as MdastTable),
};

export function astToBlocks(
  root: MdastRoot,
  registry: SchemaRegistry,
  source = "",
): PendingBlock[] {
  const blocks: PendingBlock[] = [];
  walkNodes(root.children, blocks, registry, 0, source, true);
  return blocks;
}

function walkNodes(
  nodes: MdastNode[],
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  listIndent: number,
  source: string,
  restoreSiblingGaps = false,
): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (restoreSiblingGaps && index > 0) {
      appendEmptyParagraphsBetween(source, nodes[index - 1]!, node, blocks);
    }
    if (
      node.type === "paragraph" &&
      node.children?.length === 1 &&
      node.children[0]?.type === "image"
    ) {
      const imageNode = node.children[0];
      blocks.push({
        type: "image",
        props: {
          src: imageNode.url ?? "",
          alt: imageNode.alt ?? undefined,
          caption: imageNode.title ?? undefined,
        },
      });
      continue;
    }

    const schemaBlock = resolveFromSchema(node, registry);
    if (schemaBlock) {
      const inlineSourceHtml = getMarkdownInlineHtml(schemaBlock);
      if (inlineSourceHtml !== null) {
        const inline = collectInlineHtmlContent(inlineSourceHtml);
        schemaBlock.content = inline.text;
        schemaBlock.marks = inline.marks;
      } else {
        const inlineSourceNodes = getMarkdownInlineSource(schemaBlock, node);
        if (inlineSourceNodes) {
          const inline = collectInlineContent(inlineSourceNodes);
          schemaBlock.content = inline.text;
          schemaBlock.marks = inline.marks;
        }
      }

      const nested: PendingBlock[] = [];
      const leftoverHtml = leftoverHtmlFromImport(schemaBlock);
      if (leftoverHtml) {
        nested.push(...pendingBlocksFromHtmlFragment(leftoverHtml));
      }
      const deferred = deferredMarkdownChildren(schemaBlock);
      if (deferred.length > 0) {
        walkNodes(deferred, nested, registry, listIndent, source);
      } else if (!leftoverHtml) {
        const remaining = remainingUnconsumedChildren(schemaBlock, node);
        if (remaining.length > 0) {
          walkNodes(remaining, nested, registry, listIndent, source);
        }
      }

      const unclosed = unclosedHtmlTag(node);
      if (unclosed) {
        const inner: MdastNode[] = [];
        while (
          index + 1 < nodes.length &&
          !isHtmlCloseTag(nodes[index + 1]!, unclosed)
        ) {
          index += 1;
          inner.push(nodes[index]!);
        }
        if (
          index + 1 < nodes.length &&
          isHtmlCloseTag(nodes[index + 1]!, unclosed)
        ) {
          index += 1;
        }
        walkNodes(inner, nested, registry, listIndent, source);
      }

      if (nested.length > 0) {
        schemaBlock.children = nested;
      }
      blocks.push(schemaBlock);
      continue;
    }

    const mapping = blockMappings[node.type];
    if (mapping) {
      const block = mapping(node);
      if (!block) {
        continue;
      }

      if (
        node.children &&
        block.type !== "codeBlock" &&
        block.type !== "table"
      ) {
        const ctx = { text: "", marks: [] as InlineMark[], offset: 0 };
        processInlineNodes(node.children, ctx);
        block.content = ctx.text;
        block.marks = ctx.marks;
      }

      blocks.push(block);
      continue;
    }

    if (node.type === "list") {
      walkListItems(node as MdastList, blocks, registry, listIndent, source);
      continue;
    }

    if (node.type === "listItem") {
      const block = listItemToBlock(node as MdastListItem, listIndent);
      blocks.push(block);

      if (node.children) {
        for (const child of node.children) {
          if (child.type === "list") {
            walkListItems(
              child as MdastList,
              blocks,
              registry,
              listIndent + 1,
              source,
            );
          }
        }
      }
      continue;
    }

    if (node.children && Array.isArray(node.children)) {
      walkNodes(node.children, blocks, registry, listIndent, source);
    }
  }
}

function walkListItems(
  listNode: MdastList,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  indent: number,
  source: string,
): void {
  for (let index = 0; index < listNode.children.length; index += 1) {
    const item = listNode.children[index]!;
    const emptyParagraphCount =
      index > 0
        ? appendEmptyParagraphsBetween(
            source,
            listNode.children[index - 1]!,
            item,
            blocks,
          )
        : 0;
    const block = listItemToBlock(item, indent, listNode, index);
    if (emptyParagraphCount > 0 && listNode.ordered) {
      block.props = {
        ...block.props,
        start: (listNode.start ?? 1) + index,
      };
    }
    blocks.push(block);

    for (const child of item.children ?? []) {
      if (child.type === "list") {
        walkListItems(child as MdastList, blocks, registry, indent + 1, source);
      }
    }
  }
}

type PositionedNode = MdastNode & {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

function appendEmptyParagraphsBetween(
  source: string,
  previousNode: MdastNode,
  nextNode: MdastNode,
  blocks: PendingBlock[],
): number {
  const previousEnd = (previousNode as PositionedNode).position?.end?.offset;
  const nextStart = (nextNode as PositionedNode).position?.start?.offset;
  if (previousEnd === undefined || nextStart === undefined) {
    return 0;
  }
  const gap = source.slice(previousEnd, nextStart);
  if (/[^\t\n\r ]/.test(gap)) {
    return 0;
  }
  const lineBreakCount = gap.match(/\r\n?|\n/g)?.length ?? 0;
  const count = Math.max(0, Math.floor(lineBreakCount / 2) - 1);
  for (let index = 0; index < count; index += 1) {
    blocks.push({ type: "paragraph", props: {}, content: "", marks: [] });
  }
  return count;
}

function listItemToBlock(
  item: MdastListItem,
  indent: number,
  list?: MdastList,
  index?: number,
): PendingBlock {
  if (item.checked !== undefined && item.checked !== null) {
    const ctx = { text: "", marks: [] as InlineMark[], offset: 0 };
    const inlineChildren = (item.children ?? []).filter(
      (child) => child.type !== "list",
    );
    for (const child of inlineChildren) {
      if (child.children) {
        processInlineNodes(child.children, ctx);
      }
    }
    return {
      type: "checkListItem",
      props: { indent, checked: item.checked },
      content: ctx.text,
      marks: ctx.marks,
    };
  }

  if (list?.ordered) {
    const ctx = { text: "", marks: [] as InlineMark[], offset: 0 };
    const inlineChildren = (item.children ?? []).filter(
      (child) => child.type !== "list",
    );
    for (const child of inlineChildren) {
      if (child.children) {
        processInlineNodes(child.children, ctx);
      }
    }
    return {
      type: "numberedListItem",
      props: {
        indent,
        start: index === 0 ? (list.start ?? 1) : undefined,
      },
      content: ctx.text,
      marks: ctx.marks,
    };
  }

  const ctx = { text: "", marks: [] as InlineMark[], offset: 0 };
  const inlineChildren = (item.children ?? []).filter(
    (child) => child.type !== "list",
  );
  for (const child of inlineChildren) {
    if (child.children) {
      processInlineNodes(child.children, ctx);
    }
  }
  return {
    type: "bulletListItem",
    props: { indent },
    content: ctx.text,
    marks: ctx.marks,
  };
}

function resolveFromSchema(
  node: MdastNode,
  registry: SchemaRegistry,
): BlockImportMatch | null {
  const blockSchemas = registry.allBlocks?.() ?? [];
  for (const schema of blockSchemas) {
    const serializer = schema.serialize?.fromMarkdown;
    if (!serializer) {
      continue;
    }

    const result = serializer(node as MarkdownNode);
    if (result) {
      return result;
    }
  }

  return null;
}

function getMarkdownInlineSource(
  block: BlockImportMatch,
  node: MdastNode,
): MdastNode[] | null {
  if (block.type === "codeBlock" || block.type === "table") {
    return null;
  }

  if (block.importContentSource?.markdownNodes) {
    return block.importContentSource.markdownNodes as MdastNode[];
  }

  if (block.content === undefined && node.children) {
    return node.children;
  }

  return null;
}

function getMarkdownInlineHtml(block: BlockImportMatch): string | null {
  return block.importContentSource?.markdownHtml ?? null;
}

function leftoverHtmlFromImport(block: BlockImportMatch): string | null {
  if (!block.importContentSource?.markdownHtml) {
    return null;
  }
  const nodes = block.importContentSource.markdownNodes;
  if (nodes?.length !== 1 || nodes[0]?.type !== "html") {
    return null;
  }
  const value = (nodes[0] as { value?: string }).value?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function deferredMarkdownChildren(block: BlockImportMatch): MdastNode[] {
  const deferred: MdastNode[] = [];
  for (const child of block.children ?? []) {
    const nodes = child.importContentSource?.markdownNodes;
    if (!nodes || nodes.length === 0 || child.importContentSource?.markdownHtml) {
      continue;
    }
    deferred.push(...(nodes as MdastNode[]));
  }
  return deferred;
}

function remainingUnconsumedChildren(
  block: BlockImportMatch,
  node: MdastNode,
): MdastNode[] {
  if (!node.children || node.children.length < 2) {
    return [];
  }
  if (
    block.importContentSource?.markdownNodes &&
    !block.importContentSource.markdownHtml
  ) {
    return node.children.slice(1);
  }
  return [];
}

function unclosedHtmlTag(node: MdastNode): string | null {
  if (node.type !== "html") {
    return null;
  }
  const value = (node.value ?? "").trim();
  const open = /^<([a-z][\w-]*)\b[^>]*>/i.exec(value);
  if (!open) {
    return null;
  }
  const tag = open[1]!;
  if (new RegExp(`</${tag}\\s*>`, "i").test(value)) {
    return null;
  }
  return tag;
}

function isHtmlCloseTag(node: MdastNode, tag: string): boolean {
  if (node.type !== "html") {
    return false;
  }
  return new RegExp(`^</${tag}\\s*>`, "i").test((node.value ?? "").trim());
}
