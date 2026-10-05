import type { PenBlockJSON, PenDocumentJSON } from "../json/export";
import {
	INGEST_MAX_IMAGE_COUNT,
	INGEST_MAX_NESTING_DEPTH,
	INGEST_MAX_NODE_COUNT,
	INGEST_MAX_TEXT_SIZE,
} from "../ingestBounds";

export type XmlIngestDropReason =
  | "depth-exceeded"
  | "count-exceeded"
  | "text-size-exceeded"
  | "image-count-exceeded";

export interface XmlDroppedByReason {
  readonly reason: XmlIngestDropReason;
  readonly count: number;
  readonly bound: string;
  readonly limit: number;
  readonly actual: number;
  readonly dropped: string;
}

const BOUND_BY_REASON: Record<XmlIngestDropReason, string> = {
  "depth-exceeded": "INGEST_MAX_NESTING_DEPTH",
  "count-exceeded": "INGEST_MAX_NODE_COUNT",
  "text-size-exceeded": "INGEST_MAX_TEXT_SIZE",
  "image-count-exceeded": "INGEST_MAX_IMAGE_COUNT",
};

const LIMIT_BY_REASON: Record<XmlIngestDropReason, number> = {
  "depth-exceeded": INGEST_MAX_NESTING_DEPTH,
  "count-exceeded": INGEST_MAX_NODE_COUNT,
  "text-size-exceeded": INGEST_MAX_TEXT_SIZE,
  "image-count-exceeded": INGEST_MAX_IMAGE_COUNT,
};

export class XmlIngestDropCounts {
  private readonly counts = new Map<XmlIngestDropReason, number>();
  private readonly actuals = new Map<XmlIngestDropReason, number>();

  add(reason: XmlIngestDropReason, count = 1, actual?: number): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + count);
    if (actual !== undefined) {
      this.actuals.set(reason, Math.max(this.actuals.get(reason) ?? 0, actual));
    }
  }

  toDroppedByReason(): XmlDroppedByReason[] {
    return [...this.counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([reason, count]) => {
        const actual =
          this.actuals.get(reason) ??
          (reason === "count-exceeded"
            ? INGEST_MAX_NODE_COUNT + count
            : reason === "image-count-exceeded"
              ? INGEST_MAX_IMAGE_COUNT + count
              : LIMIT_BY_REASON[reason] + count);
        return {
          reason,
          count,
          bound: BOUND_BY_REASON[reason],
          limit: LIMIT_BY_REASON[reason],
          actual,
          dropped: formatDropped(reason, count),
        };
      });
  }
}

export function capRawXmlSource(input: string): string | null {
  if (input.length <= INGEST_MAX_TEXT_SIZE) {
    return input;
  }
  return null;
}

export function assertXmlSourceWithinCap(source: string): void {
  if (source.length > INGEST_MAX_TEXT_SIZE) {
    throw new Error(
      `XML parse received ${source.length} code units; INGEST_MAX_TEXT_SIZE is ${INGEST_MAX_TEXT_SIZE}`,
    );
  }
}

export function boundPenDocument(
  document: PenDocumentJSON,
  drops: XmlIngestDropCounts,
): PenDocumentJSON {
  const state = { nodes: 0, text: 0, images: 0 };
  return {
    ...document,
    blocks: boundBlocks(document.blocks, drops, 1, state),
  };
}

function boundBlocks(
  blocks: readonly PenBlockJSON[],
  drops: XmlIngestDropCounts,
  depth: number,
  state: { nodes: number; text: number; images: number },
): PenBlockJSON[] {
  const kept: PenBlockJSON[] = [];
  for (const block of blocks) {
    if (depth > INGEST_MAX_NESTING_DEPTH) {
      drops.add("depth-exceeded", countNodes(block), depth);
      continue;
    }
    if (state.nodes >= INGEST_MAX_NODE_COUNT) {
      drops.add("count-exceeded", countNodes(block));
      continue;
    }
    if (block.type === "image" && state.images >= INGEST_MAX_IMAGE_COUNT) {
      drops.add("image-count-exceeded");
      continue;
    }
    const textLen = block.content?.text.length ?? 0;
    if (state.text + textLen > INGEST_MAX_TEXT_SIZE) {
      drops.add("text-size-exceeded", textLen, state.text + textLen);
      continue;
    }

    state.nodes += 1;
    state.text += textLen;
    if (block.type === "image") {
      state.images += 1;
    }

    const next: PenBlockJSON = { ...block };
    if (block.children) {
      next.children = boundBlocks(block.children, drops, depth + 1, state);
    }
    kept.push(next);
  }
  return kept;
}

function countNodes(block: PenBlockJSON): number {
  let count = 1;
  if (block.children) {
    for (const child of block.children) {
      count += countNodes(child);
    }
  }
  return count;
}

function formatDropped(reason: XmlIngestDropReason, count: number): string {
  switch (reason) {
    case "text-size-exceeded":
      return `${count} code unit${count === 1 ? "" : "s"}`;
    case "image-count-exceeded":
      return `${count} image${count === 1 ? "" : "s"}`;
    case "depth-exceeded":
    case "count-exceeded":
      return `${count} block${count === 1 ? "" : "s"}`;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}
