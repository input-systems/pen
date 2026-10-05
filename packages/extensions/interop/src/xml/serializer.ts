import type {
  PenBlockJSON,
  PenDocumentJSON,
  PenInlineContentJSON,
  PenInlineSegmentJSON,
  PenMarkJSON,
} from "../json/export";
import { urlPolicy } from "@input/pen-core";
import { escapeMarkupAttribute, escapeMarkupText } from "../escapeMarkup";

const INDENT = "  ";

export function serializePenDocumentToXml(document: PenDocumentJSON): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`${serializeOpenTag("pen-document", { version: document.version })}`);

  if (document.metadata) {
    lines.push(
      `${INDENT}${serializeElement("metadata", undefined, jsonText(document.metadata))}`,
    );
  }

  for (const block of document.blocks) {
    lines.push(...serializeBlock(block, 1));
  }

  lines.push(serializeCloseTag("pen-document"));
  return lines.join("\n");
}

function serializeBlock(block: PenBlockJSON, depth: number): string[] {
  const indent = INDENT.repeat(depth);
  const lines: string[] = [
    `${indent}${serializeOpenTag("block", { id: block.id, type: block.type })}`,
    `${indent}${INDENT}${serializeElement("props", undefined, jsonText(admitUrlFields(block.props ?? {})))}`,
  ];

  if (block.content) {
    lines.push(...serializeInlineContent(block.content, depth + 1));
  }

  if (block.children && block.children.length > 0) {
    lines.push(`${indent}${INDENT}${serializeOpenTag("children")}`);
    for (const child of block.children) {
      lines.push(...serializeBlock(child, depth + 2));
    }
    lines.push(`${indent}${INDENT}${serializeCloseTag("children")}`);
  }

  lines.push(`${indent}${serializeCloseTag("block")}`);
  return lines;
}

function serializeInlineContent(
  content: PenInlineContentJSON,
  depth: number,
): string[] {
  const indent = INDENT.repeat(depth);
  const lines = [
    `${indent}${serializeElement("content", undefined, escapeMarkupText(content.text))}`,
  ];

  if (content.marks && content.marks.length > 0) {
    lines.push(`${indent}${serializeOpenTag("marks")}`);
    for (const mark of content.marks) {
      lines.push(serializeMark(mark, depth + 1));
    }
    lines.push(`${indent}${serializeCloseTag("marks")}`);
  }

  if (content.segments && content.segments.length > 0) {
    lines.push(`${indent}${serializeOpenTag("segments")}`);
    for (const segment of content.segments) {
      lines.push(serializeInlineSegment(segment, depth + 1));
    }
    lines.push(`${indent}${serializeCloseTag("segments")}`);
  }

  return lines;
}

function serializeInlineSegment(
  segment: PenInlineSegmentJSON,
  depth: number,
): string {
  const indent = INDENT.repeat(depth);
  if (segment.type === "text") {
    return `${indent}${serializeElement(
      "text",
      segment.attributes
        ? { attributes: jsonValue(admitUrlFields(segment.attributes)) }
        : undefined,
      escapeMarkupText(segment.text),
    )}`;
  }

  return `${indent}${serializeVoidElement("node", {
    type: segment.nodeType,
    ...optionalAdmittedJsonAttribute("props", segment.props),
  })}`;
}

function serializeMark(mark: PenMarkJSON, depth: number): string {
  const indent = INDENT.repeat(depth);
  return `${indent}${serializeVoidElement("mark", {
    type: mark.type,
    start: mark.start,
    end: mark.end,
    ...optionalAdmittedJsonAttribute("props", mark.props),
  })}`;
}

function jsonText(value: unknown): string {
  return escapeMarkupText(JSON.stringify(value));
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

function optionalAdmittedJsonAttribute(
  name: string,
  value: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!value) {
    return {};
  }

  const admitted = admitUrlFields(value);
  if (Object.keys(admitted).length === 0) {
    return {};
  }

  return { [name]: jsonValue(admitted) };
}

function admitUrlFields(value: Record<string, unknown>): Record<string, unknown> {
  const admitted: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(value)) {
    const urlKind = urlFieldKind(key);
    if (urlKind) {
      const resolved = urlPolicy.resolve(raw, urlKind);
      if (resolved !== null) {
        admitted[key] = resolved;
      }
      continue;
    }

    admitted[key] = isRecord(raw) ? admitUrlFields(raw) : raw;
  }

  return admitted;
}

function urlFieldKind(key: string): "link" | "image" | null {
  const lower = key.toLowerCase();
  if (lower === "href") {
    return "link";
  }
  if (lower === "src") {
    return "image";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeOpenTag(
  tag: string,
  attributes?: Record<string, string | number>,
): string {
  return `<${tag}${serializeAttributes(attributes)}>`;
}

function serializeCloseTag(tag: string): string {
  return `</${tag}>`;
}

function serializeElement(
  tag: string,
  attributes: Record<string, string | number> | undefined,
  innerSerialized: string,
): string {
  return `${serializeOpenTag(tag, attributes)}${innerSerialized}${serializeCloseTag(tag)}`;
}

function serializeVoidElement(
  tag: string,
  attributes?: Record<string, string | number>,
): string {
  return `<${tag}${serializeAttributes(attributes)} />`;
}

function serializeAttributes(
  attributes?: Record<string, string | number>,
): string {
  if (!attributes) {
    return "";
  }

  let result = "";
  for (const [name, raw] of Object.entries(attributes)) {
    const urlKind = urlFieldKind(name);
    if (urlKind) {
      const resolved = urlPolicy.resolve(raw, urlKind);
      if (resolved === null) {
        continue;
      }
      result += ` ${name}="${escapeMarkupAttribute(resolved)}"`;
      continue;
    }

    result += ` ${name}="${escapeMarkupAttribute(String(raw))}"`;
  }
  return result;
}
