// @vitest-environment jsdom

import { fieldEditorHostFacet } from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom";
import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
  document.body.replaceChildren();
});

describe("@input/pen-vue AX1 surface", () => {
  it("AX1: content root is a multiline textbox", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Hello",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const root = wrapper.get("[data-pen-editor-root]");
    expect(root.attributes("role")).toBe("textbox");
    expect(root.attributes("aria-multiline")).toBe("true");
    expect(root.attributes("aria-label")).toBe("Editor");
    expect(root.attributes("tabindex")).toBe("0");

    wrapper.unmount();
    editor.destroy();
  });

  it("AX1: content root uses createEditor a11yLabel", () => {
    const editor = createTestEditor({
      a11yLabel: "Compose email",
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Hello",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const root = wrapper.get("[data-pen-editor-root]");
    expect(root.attributes("aria-label")).toBe("Compose email");
    expect(root.attributes("aria-labelledby")).toBeUndefined();

    wrapper.unmount();
    editor.destroy();
  });

  it("AX1: readonly prop is reflected as aria-readonly", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Hello",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor, readonly: true },
    });

    expect(wrapper.get("[data-pen-editor-root]").attributes("aria-readonly")).toBe(
      "true",
    );

    wrapper.unmount();
    editor.destroy();
  });

  it("AX1: marks only the active inline surface as a nested multiline textbox", async () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Hello",
        },
        {
          id: "paragraph-2",
          type: "paragraph",
          props: {},
          content: "World",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const firstSurface = wrapper.get(
      '[data-block-id="paragraph-1"] [data-pen-inline-content]',
    );
    const secondSurface = wrapper.get(
      '[data-block-id="paragraph-2"] [data-pen-inline-content]',
    );

    expect(
      wrapper.findAll('[role="textbox"]:not([data-pen-editor-root])'),
    ).toHaveLength(0);

    const fieldEditor = editor.facet(
      fieldEditorHostFacet,
    ) as FieldEditorImpl | null;
    fieldEditor?.activate("paragraph-1");
    await nextTick();

    expect(firstSurface.attributes("role")).toBe("textbox");
    expect(firstSurface.attributes("aria-multiline")).toBe("true");
    expect(firstSurface.attributes("aria-label")).toBe("Editor");
    expect(secondSurface.attributes("role")).toBeUndefined();
    expect(secondSurface.attributes("aria-label")).toBeUndefined();

    wrapper.unmount();
    editor.destroy();
  });

  it("AX1: marks the active table cell surface as a nested multiline textbox", async () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "t1",
          type: "table",
          props: {},
        },
      ],
    });
    editor.apply([
      {
        type: "splice-text",
        blockId: "t1",
        cell: { row: 0, col: 0 },
        from: 0,
        to: 0,
        insert: "Alpha",
      },
      {
        type: "splice-text",
        blockId: "t1",
        cell: { row: 0, col: 1 },
        from: 0,
        to: 0,
        insert: "Beta",
      },
    ]);

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const firstCellSurface = wrapper.get(
      '[data-block-id="t1"] [data-cell-row="0"][data-cell-col="0"] [data-pen-field-editor-surface]',
    );
    const secondCellSurface = wrapper.get(
      '[data-block-id="t1"] [data-cell-row="0"][data-cell-col="1"] [data-pen-field-editor-surface]',
    );

    expect(
      wrapper.findAll('[role="textbox"]:not([data-pen-editor-root])'),
    ).toHaveLength(0);

    const fieldEditor = editor.facet(
      fieldEditorHostFacet,
    ) as FieldEditorImpl | null;
    fieldEditor?.activateCellFromElement?.(
      "t1",
      0,
      0,
      firstCellSurface.element as HTMLElement,
    );
    await nextTick();

    expect(firstCellSurface.attributes("role")).toBe("textbox");
    expect(firstCellSurface.attributes("aria-multiline")).toBe("true");
    expect(firstCellSurface.attributes("aria-label")).toBe("Editor");
    expect(secondCellSurface.attributes("role")).toBeUndefined();
    expect(secondCellSurface.attributes("aria-label")).toBeUndefined();

    wrapper.unmount();
    editor.destroy();
  });
});
