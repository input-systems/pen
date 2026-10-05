import {
  jsonImporter,
  type PenBlockJSON,
  type PenDocumentJSON,
  type PenInlineSegmentJSON,
  type PenMarkJSON,
} from "../json/export";
import { parseDocument } from "htmlparser2";
import type { ChildNode, Document, Element } from "domhandler";
import type {
  Editor,
  Importer,
  ImportOptions,
  ImportResult,
  XMLElement,
} from "@input/pen-types";
import {
  assertXmlSourceWithinCap,
  boundPenDocument,
  capRawXmlSource,
  XmlIngestDropCounts,
  type XmlDroppedByReason,
} from "./ingestBounds";
import { INGEST_MAX_TEXT_SIZE } from "../ingestBounds";

export interface XmlImportResult extends ImportResult {
  readonly droppedByReason?: readonly XmlDroppedByReason[];
}

export interface XmlImporter extends Importer<string, PenDocumentJSON> {
  import(
    input: string,
    editor: Editor,
    options?: ImportOptions,
  ): XmlImportResult | void | Promise<XmlImportResult | void>;
}

export const xmlImporter: XmlImporter = {
  name: "xml",
  mimeType: "application/xml",

  parse(input: string): PenDocumentJSON {
    return ingestXmlDocument(input).document;
  },

  import(
    input: string,
    editor: Editor,
    options?: ImportOptions,
  ): XmlImportResult | void | Promise<XmlImportResult | void> {
    const { document, drops, refused } = ingestXmlDocument(input);
    const droppedByReason = drops.toDroppedByReason();
    if (droppedByReason.length > 0) {
      editor.internals.emit("diagnostic", {
        code: "import-truncated",
        level: "warn",
        source: "import-xml",
        message: formatXmlIngestMessage(droppedByReason),
        droppedByReason,
      });
    }
    if (refused) {
      return {
        parsedTopLevelBlockCount: 0,
        importedTopLevelBlockCount: 0,
        droppedBlockCount: 0,
        droppedBlockTypes: [],
        normalized: true,
        droppedByReason,
      };
    }
    const result = jsonImporter.import(document, editor, options);
    if (!result || result instanceof Promise) {
      return result;
    }
    return droppedByReason.length > 0
      ? { ...result, droppedByReason, normalized: true }
      : result;
  },
};

function ingestXmlDocument(input: string): {
  document: PenDocumentJSON;
  drops: XmlIngestDropCounts;
  refused: boolean;
} {
  const drops = new XmlIngestDropCounts();
  const capped = capRawXmlSource(input);
  if (capped == null) {
    drops.add(
      "text-size-exceeded",
      input.length - INGEST_MAX_TEXT_SIZE,
      input.length,
    );
    return { document: { version: 1, blocks: [] }, drops, refused: true };
  }
  return {
    document: boundPenDocument(parseXmlDocument(capped), drops),
    drops,
    refused: false,
  };
}

function formatXmlIngestMessage(
  droppedByReason: readonly { dropped: string; reason: string; bound: string; actual: number; limit: number }[],
): string {
  const parts = droppedByReason.map(
    (entry) =>
      `${entry.dropped} ${entry.reason} (${entry.bound}) actual ${entry.actual} limit ${entry.limit}`,
  );
  return `import truncated: ${parts.join("; ")}`;
}

export function parseXmlDocument(input: string): PenDocumentJSON {
  assertXmlSourceWithinCap(input);
  const document = parseDocument(input, {
    xmlMode: true,
    recognizeCDATA: true,
    recognizeSelfClosing: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    decodeEntities: true,
  });

  const root = firstElementChild(document);
  if (!root || root.tagName !== "pen-document") {
    throw new Error("Invalid Pen XML document.");
  }

  const version = Number(root.attributes.version);
  if (version !== 1) {
    throw new Error("Unsupported Pen XML document version.");
  }

  const metadataElement = childElement(root, "metadata");
  const metadata = metadataElement?.textContent
    ? parseJsonValue<Record<string, unknown>>(metadataElement.textContent, "metadata")
    : undefined;

  const blocks = childElements(root, "block").map(parseXmlBlock);

  return {
    version: 1,
    ...(metadata ? { metadata } : {}),
    blocks,
  };
}

function parseXmlBlock(element: XMLElement): PenBlockJSON {
  const id = element.attributes.id;
  const type = element.attributes.type;

  if (!id || !type) {
    throw new Error("Invalid Pen XML block: missing id or type.");
  }

  const props = parseChildJson<Record<string, unknown>>(element, "props") ?? {};
  const contentElement = childElement(element, "content");
  const marksParent = childElement(element, "marks");
  const marks = marksParent
    ? childElements(marksParent, "mark").map(parseXmlMark)
    : undefined;
  const segmentsParent = childElement(element, "segments");
  const segments = segmentsParent
    ? parseXmlInlineSegments(segmentsParent)
    : undefined;
  const childrenParent = childElement(element, "children");
  const children = childrenParent
    ? childElements(childrenParent, "block").map(parseXmlBlock)
    : undefined;

  return {
    id,
    type,
    props,
    ...(contentElement
      ? {
          content: {
            text: contentElement.textContent ?? "",
            ...(marks && marks.length > 0 ? { marks } : {}),
            ...(segments && segments.length > 0 ? { segments } : {}),
          },
        }
      : {}),
    ...(children && children.length > 0 ? { children } : {}),
  };
}

function parseXmlInlineSegments(element: XMLElement): PenInlineSegmentJSON[] {
  const segments: PenInlineSegmentJSON[] = [];

  for (const child of element.children) {
    if (child.tagName === "text") {
      segments.push({
        type: "text" as const,
        text: child.textContent ?? "",
        ...(child.attributes.attributes
          ? {
              attributes: parseJsonValue<Record<string, unknown>>(
                child.attributes.attributes,
                "text segment attributes",
              ),
            }
          : {}),
      });
      continue;
    }

    if (child.tagName === "node") {
      const nodeType = child.attributes.type;
      if (!nodeType) {
        throw new Error("Invalid Pen XML inline node segment.");
      }
      segments.push({
        type: "node" as const,
        nodeType,
        ...(child.attributes.props
          ? {
              props: parseJsonValue<Record<string, unknown>>(
                child.attributes.props,
                `node segment props for ${nodeType}`,
              ),
            }
          : {}),
      });
    }
  }

  return segments;
}

function parseXmlMark(element: XMLElement): PenMarkJSON {
  const type = element.attributes.type;
  const start = Number(element.attributes.start);
  const end = Number(element.attributes.end);

  if (!type || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error("Invalid Pen XML mark.");
  }

  return {
    type,
    start,
    end,
    ...(element.attributes.props
      ? {
          props: parseJsonValue<Record<string, unknown>>(
            element.attributes.props,
            `mark props for ${type}`,
          ),
        }
      : {}),
  };
}

function parseChildJson<T>(element: XMLElement, tagName: string): T | undefined {
  const child = childElement(element, tagName);
  if (!child?.textContent) {
    return undefined;
  }

  return parseJsonValue<T>(child.textContent, tagName);
}

function parseJsonValue<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // invalid json becomes a labeled importer error.
    throw new Error(`Invalid Pen XML ${label} payload.`);
  }
}

function firstElementChild(document: Document): XMLElement | null {
  for (const child of document.children) {
    const element = toXMLElement(child);
    if (element) {
      return element;
    }
  }

  return null;
}

function childElement(element: XMLElement, tagName: string): XMLElement | null {
  return element.children.find((child) => child.tagName === tagName) ?? null;
}

function childElements(element: XMLElement, tagName: string): XMLElement[] {
  return element.children.filter((child) => child.tagName === tagName);
}

function toXMLElement(node: ChildNode): XMLElement | null {
  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") {
    return null;
  }

  const element = node as Element;
  const children = (element.children ?? [])
    .map((child) => toXMLElement(child))
    .filter((child): child is XMLElement => child !== null);

  const textContent = extractTextContent(element.children ?? []);

  return {
    tagName: element.name,
    attributes: element.attribs ?? {},
    children,
    ...(textContent.length > 0 ? { textContent } : {}),
  };
}

function extractTextContent(children: ChildNode[]): string {
  let text = "";

  for (const child of children) {
    if (child.type === "text" || child.type === "cdata") {
      text += "data" in child ? String(child.data) : "";
      continue;
    }

    if ("children" in child && Array.isArray(child.children)) {
      text += extractTextContent(child.children);
    }
  }

  return text;
}
