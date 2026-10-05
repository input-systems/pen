import { describe, expect, it } from "vitest";
import type { ChangeSummary } from "../types/changes";
import type {
  CommitEvent,
  CommitEventSource,
  SelectionRecord,
} from "../types/editor";

function emptySummary(commitId: number): ChangeSummary {
  return {
    commitId,
    blockText: [],
    structural: [],
    affectedBlockIds: [],
  };
}

function record(commitId: number): SelectionRecord {
  return {
    state: null,
    version: 1,
    origin: "programmatic",
    commitId,
  };
}

function commit(source: CommitEventSource): CommitEvent {
  return {
    commitId: 1,
    origin: { type: "user" },
    summary: emptySummary(1),
    selectionBefore: record(0),
    selectionAfter: record(1),
    source,
    diagnostics: [],
  };
}

describe("CommitEvent", () => {
  it("is the spec shape: commitId, structured origin, summary, selection records, source, diagnostics", () => {
    const event = commit("apply");

    expect(event.commitId).toBe(1);
    expect(event.origin).toEqual({ type: "user" });
    expect(event.summary.blockText).toEqual([]);
    expect(event.summary.structural).toEqual([]);
    expect(event.summary.affectedBlockIds).toEqual([]);
    expect(event.selectionBefore.commitId).toBe(0);
    expect(event.selectionAfter.commitId).toBe(1);
    expect(event.source).toBe("apply");
    expect(event.diagnostics).toEqual([]);
    expect("empty" in event).toBe(false);
  });

  it("source is apply | remote | undo | redo | stream", () => {
    const sources: readonly CommitEventSource[] = [
      "apply",
      "remote",
      "undo",
      "redo",
      "stream",
    ];

    expect(sources).toHaveLength(5);
    expect(sources.map((source) => commit(source).source)).toEqual(sources);
  });
});
