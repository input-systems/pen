import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { PenBlockJSON } from "../../json/export";
import { defaultSchema } from "@input/pen-schema";
import { xmlImporter } from "../importer";
import {
  INGEST_MAX_IMAGE_COUNT,
  INGEST_MAX_NESTING_DEPTH,
  INGEST_MAX_NODE_COUNT,
} from "../../ingestBounds";
import { XmlIngestDropCounts, boundPenDocument } from "../ingestBounds";

const noDefaultExtensionsPreset = {
  resolve() {
    return { extensions: [] };
  },
};

function createBareEditor() {
  const editor = createEditor({
    schema: defaultSchema,
    preset: noDefaultExtensionsPreset,
  });
  const existingBlockIds = [...editor.documentState.allBlocks()]
    .filter((handle) => handle.parent === null)
    .map((handle) => handle.id);
  if (existingBlockIds.length > 0) {
    editor.apply(
      existingBlockIds.reverse().map((blockId) => ({
        type: "delete-block" as const,
        blockId,
      })),
    );
  }
  return editor;
}

function paragraph(id: string, text = "Hi"): PenBlockJSON {
  return {
    id,
    type: "paragraph",
    props: {},
    content: { text },
  };
}

function nestToggles(depth: number): PenBlockJSON {
  if (depth <= 1) {
    return paragraph("leaf");
  }
  return {
    id: `toggle-${depth}`,
    type: "toggle",
    props: {},
    content: { text: `d${depth}` },
    children: [nestToggles(depth - 1)],
  };
}

describe("IOP5 XML ingest bounds", () => {
  it("IOP5 truncates oversize node count at a block boundary", () => {
    const drops = new XmlIngestDropCounts();
    const blocks = Array.from({ length: INGEST_MAX_NODE_COUNT + 4 }, (_, index) =>
      paragraph(`p-${index}`),
    );

    const bounded = boundPenDocument({ version: 1, blocks }, drops);

    expect(bounded.blocks).toHaveLength(INGEST_MAX_NODE_COUNT);
    expect(drops.toDroppedByReason()).toEqual([
      {
        reason: "count-exceeded",
        count: 4,
        bound: "INGEST_MAX_NODE_COUNT",
        limit: INGEST_MAX_NODE_COUNT,
        actual: INGEST_MAX_NODE_COUNT + 4,
        dropped: "4 blocks",
      },
    ]);
  });

  it("IOP5 truncates deep nesting past depth 32", () => {
    const drops = new XmlIngestDropCounts();
    const bounded = boundPenDocument(
      { version: 1, blocks: [nestToggles(INGEST_MAX_NESTING_DEPTH + 1)] },
      drops,
    );

    expect(drops.toDroppedByReason()).toEqual([
      {
        reason: "depth-exceeded",
        count: 1,
        bound: "INGEST_MAX_NESTING_DEPTH",
        limit: INGEST_MAX_NESTING_DEPTH,
        actual: INGEST_MAX_NESTING_DEPTH + 1,
        dropped: "1 block",
      },
    ]);

    let depth = 0;
    let current: PenBlockJSON | undefined = bounded.blocks[0];
    while (current) {
      depth += 1;
      current = current.children?.[0];
    }
    expect(depth).toBe(INGEST_MAX_NESTING_DEPTH);
  });

  it("IOP5 truncates many images and names the bound on the live import path", async () => {
    const editor = createBareEditor();
    const diagnostics: Array<{ code: string; droppedByReason?: unknown }> = [];
    editor.on("diagnostic", (event) => {
      diagnostics.push(event);
    });

    const images = Array.from(
      { length: INGEST_MAX_IMAGE_COUNT + 3 },
      (_, index) =>
        `<block id="img-${index}" type="image"><props>{"src":"https://example.com/${index}.png"}</props></block>`,
    ).join("");
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<pen-document version="1">${images}</pen-document>`;

    const result = await xmlImporter.import(xml, editor);

    const imageCount = [...editor.documentState.allBlocks()].filter(
      (block) => block.type === "image",
    ).length;
    expect(imageCount).toBe(INGEST_MAX_IMAGE_COUNT);
    expect(result).toMatchObject({
      droppedByReason: [
        {
          reason: "image-count-exceeded",
          count: 3,
          bound: "INGEST_MAX_IMAGE_COUNT",
          limit: INGEST_MAX_IMAGE_COUNT,
          actual: INGEST_MAX_IMAGE_COUNT + 3,
          dropped: "3 images",
        },
      ],
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "import-truncated",
      }),
    ]);

    editor.destroy();
  });
});
