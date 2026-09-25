import type { InlineMark, MdastNode } from "./markdownTypes";

interface InlineContext {
  text: string;
  marks: InlineMark[];
  offset: number;
}

export function processInlineNodes(
  nodes: MdastNode[],
  ctx: InlineContext,
): void {
  let underlineStart: number | null = null;
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        ctx.text += node.value ?? "";
        ctx.offset += (node.value ?? "").length;
        break;

      case "strong": {
        const start = ctx.offset;
        processInlineNodes(node.children ?? [], ctx);
        ctx.marks.push({ type: "bold", start, end: ctx.offset });
        break;
      }

      case "emphasis": {
        const start = ctx.offset;
        processInlineNodes(node.children ?? [], ctx);
        ctx.marks.push({ type: "italic", start, end: ctx.offset });
        break;
      }

      case "delete": {
        const start = ctx.offset;
        processInlineNodes(node.children ?? [], ctx);
        ctx.marks.push({ type: "strikethrough", start, end: ctx.offset });
        break;
      }

      case "inlineCode":
        ctx.marks.push({
          type: "code",
          start: ctx.offset,
          end: ctx.offset + (node.value ?? "").length,
        });
        ctx.text += node.value ?? "";
        ctx.offset += (node.value ?? "").length;
        break;

      case "link": {
        const start = ctx.offset;
        processInlineNodes(node.children ?? [], ctx);
        ctx.marks.push({
          type: "link",
          props: { href: node.url, title: node.title ?? undefined },
          start,
          end: ctx.offset,
        });
        break;
      }

      case "image":
        ctx.text += node.alt ?? "";
        ctx.offset += (node.alt ?? "").length;
        break;

      case "html": {
        if (isUnderlineOpenTag(node.value)) {
          underlineStart = ctx.offset;
          break;
        }
        if (isUnderlineCloseTag(node.value) && underlineStart !== null) {
          ctx.marks.push({
            type: "underline",
            start: underlineStart,
            end: ctx.offset,
          });
          underlineStart = null;
          break;
        }
        const stripped = stripHTMLTags(node.value ?? "");
        ctx.text += stripped;
        ctx.offset += stripped.length;
        break;
      }

      default:
        if (node.children && Array.isArray(node.children)) {
          processInlineNodes(node.children, ctx);
        } else if (typeof node.value === "string") {
          ctx.text += node.value;
          ctx.offset += node.value.length;
        }
        break;
    }
  }
}

function isUnderlineOpenTag(value: string | undefined): boolean {
  return /^<u\s*>$/i.test(value?.trim() ?? "");
}

function isUnderlineCloseTag(value: string | undefined): boolean {
  return /^<\/u\s*>$/i.test(value?.trim() ?? "");
}

export function collectInlineContent(nodes: MdastNode[]): {
  text: string;
  marks: InlineMark[];
} {
  const ctx: InlineContext = { text: "", marks: [], offset: 0 };
  processInlineNodes(nodes, ctx);
  return { text: ctx.text, marks: ctx.marks };
}

function stripHTMLTags(html: string): string {
  let text = "";
  let inTag = false;
  for (const ch of html) {
    if (ch === "<") {
      inTag = true;
      continue;
    }
    if (ch === ">") {
      inTag = false;
      continue;
    }
    if (!inTag) {
      text += ch;
    }
  }
  return text;
}
