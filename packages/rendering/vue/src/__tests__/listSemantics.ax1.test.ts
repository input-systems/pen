// @vitest-environment jsdom

import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
  document.body.replaceChildren();
});

/** Block ids, with each list group as a nested array. */
function structure(host: Element): unknown[] {
  return [...host.children].map((child) =>
    child.hasAttribute("data-pen-list-group")
      ? [...child.children].map((item) => item.getAttribute("data-block-id"))
      : child.getAttribute("data-block-id"),
  );
}

function itemAttributes(root: Element, blockId: string) {
  const element = root.querySelector(
    `[data-pen-editor-block][data-block-id="${blockId}"]`,
  )!;
  return ["role", "aria-level", "aria-posinset", "aria-setsize"].map((name) =>
    element.getAttribute(name),
  );
}

describe("Vue list semantics (AX1)", () => {
  it("AX1: PenContent wraps list runs in role=list groups with listitem attributes on the block wrapper", async () => {
    const editor = createTestEditor({
      blocks: [
        { id: "p1", type: "paragraph", props: {}, content: "intro" },
        { id: "b1", type: "bulletListItem", props: {}, content: "one" },
        { id: "b2", type: "bulletListItem", props: { indent: 1 }, content: "nested" },
        { id: "b3", type: "bulletListItem", props: {}, content: "two" },
        { id: "q", type: "blockquote", props: {}, content: "quote" },
        { id: "q1", type: "bulletListItem", props: { parentId: "q" }, content: "in quote" },
        { id: "q2", type: "bulletListItem", props: { parentId: "q" }, content: "in quote" },
      ],
    });
    const wrapper = mount(PenEditor, { attachTo: document.body, props: { editor } });
    await nextTick();
    const root = wrapper.element as HTMLElement;
    const host = root.querySelector("[data-pen-editor-blocks-host]")!;

    expect(structure(host)).toEqual(["p1", ["b1", "b2", "b3"], "q"]);
    const group = host.querySelector("[data-pen-list-group]")!;
    expect(group.getAttribute("role")).toBe("list");
    expect(group.getAttribute("style")).toBeNull();
    expect(itemAttributes(root, "b2")).toEqual(["listitem", "2", "1", "1"]);
    expect(itemAttributes(root, "b3")).toEqual(["listitem", "1", "2", "2"]);
    expect(itemAttributes(root, "p1")).toEqual([null, null, null, null]);
    expect(root.querySelectorAll("ul, ol, li")).toHaveLength(0);
    for (const layout of root.querySelectorAll("[data-pen-list-item-layout]")) {
      expect(layout.hasAttribute("role")).toBe(false);
    }

    // RI6: a container's children form their own sibling list and group.
    const quoteGroups = root
      .querySelector('[data-block-id="q"]')!
      .querySelectorAll("[data-pen-list-group]");
    expect(quoteGroups).toHaveLength(1);
    expect(itemAttributes(root, "q2")).toEqual(["listitem", "1", "2", "2"]);

    // A child's type change re-segments its parent without changing its child ids.
    editor.apply(
      [{ type: "set-props", blockId: "q2", props: { type: "numberedListItem" } }],
      { origin: "user" },
    );
    await nextTick();
    expect(editor.documentState.parentOf("q2")).toBe("q");
    const quoteChildren = root.querySelector('[data-block-id="q"]')!
      .querySelectorAll("[data-pen-list-group]");
    expect(quoteChildren).toHaveLength(2);
    expect(itemAttributes(root, "q1")).toEqual(["listitem", "1", "1", "1"]);
    expect(itemAttributes(root, "q2")).toEqual(["listitem", "1", "1", "1"]);

    // Inserting before b3 moves b3's position.
    editor.apply(
      [
        {
          type: "insert-block",
          blockId: "b0",
          blockType: "bulletListItem",
          props: {},
          position: { after: "b2" },
        },
      ],
      { origin: "user" },
    );
    await nextTick();
    expect(structure(host)).toEqual(["p1", ["b1", "b2", "b0", "b3"], "q"]);
    expect(itemAttributes(root, "b3")).toEqual(["listitem", "1", "3", "3"]);

    wrapper.unmount();
    editor.destroy();
  });
});
