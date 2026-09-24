// @vitest-environment jsdom

import { fieldEditorHostFacet } from "@input/pen-core";
import {
  handleEditorDocumentKeyDown,
  type FieldEditorImpl,
} from "@input/pen-dom";
import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { h, nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
  document.body.replaceChildren();
});

function createTableEditor() {
  const editor = createTestEditor({
    blocks: [
      {
        id: "table-1",
        type: "table",
        props: {},
      },
    ],
  });

  editor.apply([
    {
      type: "splice-text",
      blockId: "table-1",
      cell: { row: 0, col: 0 },
      from: 0,
      to: 0,
      insert: "A1",
    },
  ]);

  return editor;
}

function createParagraphEditor() {
  return createTestEditor({
    blocks: [
      {
        id: "paragraph-1",
        type: "paragraph",
        props: {},
        content: "First",
      },
      {
        id: "paragraph-2",
        type: "paragraph",
        props: {},
        content: "Second",
      },
    ],
  });
}

function createClipboardData(): DataTransfer {
  const data = new Map<string, string>();

  return {
    files: [] as unknown as FileList,
    types: [],
    getData(type: string) {
      return data.get(type) ?? "";
    },
    setData(type: string, value: string) {
      data.set(type, value);
    },
  } as unknown as DataTransfer;
}

function setDomTextSelection(
  element: HTMLElement,
  startOffset: number,
  endOffset = startOffset,
) {
  const ownerDocument = element.ownerDocument;
  const selection = ownerDocument.getSelection();
  const textNode = element.firstChild;
  if (!selection || textNode?.nodeType !== Node.TEXT_NODE) {
    return;
  }

  const range = ownerDocument.createRange();
  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function dispatchBeforeInput(
  element: HTMLElement,
  options: {
    inputType: string;
    data?: string;
    dataTransfer?: DataTransfer;
  },
) {
  const event = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data: options.data,
    inputType: options.inputType,
  });

  if (options.dataTransfer) {
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: options.dataTransfer,
    });
  }

  element.dispatchEvent(event);
}

async function flushTransfer() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe("@input/pen-vue", () => {
  it("mounts and renders a basic paragraph document", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Hello Vue",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    expect(wrapper.text()).toContain("Hello Vue");
    expect(editor.facet(fieldEditorHostFacet)).toBeTruthy();

    wrapper.unmount();
    editor.destroy();
  });

  it("deletes a block selection with Backspace", async () => {
    const editor = createParagraphEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });
    await nextTick();

    editor.selectBlock("paragraph-1");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
      }),
    );
    await nextTick();

    expect(editor.documentState.blockOrder).toEqual(["paragraph-2"]);
    expect(editor.getBlock("paragraph-2").textContent()).toBe("Second");

    wrapper.unmount();
    editor.destroy();
  });

  it("activates the inline field editor on click", async () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Click me",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const inlineSurface = wrapper.get("[data-pen-inline-content]");
    await inlineSurface.trigger("mousedown");
    await inlineSurface.trigger("click");
    await nextTick();

    expect(
      wrapper.find("[data-pen-field-editor-active-surface]").exists(),
    ).toBe(true);

    wrapper.unmount();
    editor.destroy();
  });

  it("activates the field editor when the empty block host is clicked", async () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const blockHost = wrapper.get('[data-block-id="paragraph-1"]');
    await blockHost.trigger("mousedown");
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-1" },
      focus: { blockId: "paragraph-1" },
    });
    expect(
      wrapper.find("[data-pen-field-editor-active-surface]").exists(),
    ).toBe(true);

    wrapper.unmount();
    editor.destroy();
  });

  it("renders a block with a custom renderer override", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Override me",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: {
        editor,
        renderers: {
          paragraph: (block) =>
            h("div", { "data-custom-renderer": "" }, `Custom ${block.textContent()}`),
        },
      },
    });

    expect(wrapper.find("[data-custom-renderer]").exists()).toBe(true);
    expect(wrapper.text()).toContain("Custom Override me");

    wrapper.unmount();
    editor.destroy();
  });

  it("selects and activates a table cell for editing", async () => {
    const editor = createTableEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const tableCell = wrapper.get("[data-pen-table-cell]");
    await tableCell.trigger("mousedown");
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "cell",
      blockId: "table-1",
      anchor: { row: 0, col: 0 },
      head: { row: 0, col: 0 },
    });

    await tableCell.trigger("dblclick");
    await nextTick();

    expect(
      wrapper.find("[data-pen-field-editor-active-surface]").exists(),
    ).toBe(true);

    wrapper.unmount();
    editor.destroy();
  });

  it("moves table selection with ArrowRight and enters editing with Enter", async () => {
    const editor = createTableEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const firstCell = wrapper.get("[data-pen-table-cell]");
    await firstCell.trigger("mousedown");
    await nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "cell",
      blockId: "table-1",
      anchor: { row: 0, col: 1 },
      head: { row: 0, col: 1 },
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(
      wrapper.find("[data-pen-field-editor-active-surface]").exists(),
    ).toBe(true);

    wrapper.unmount();
    editor.destroy();
  });

  it("activates inline editing from a block selection with Enter", async () => {
    const editor = createParagraphEditor();
    editor.selectBlock("paragraph-1");

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor, interactionModel: "block-first" },
    });
    await nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-1", offset: 5 },
      focus: { blockId: "paragraph-1", offset: 5 },
    });

    wrapper.unmount();
    editor.destroy();
  });

  it("moves from block selection to the next inline block with ArrowDown", async () => {
    const editor = createParagraphEditor();
    editor.selectBlock("paragraph-1");

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });
    await nextTick();

    const fieldEditor = editor.facet(
      fieldEditorHostFacet,
    ) as FieldEditorImpl | null;
    if (!fieldEditor) {
      throw new Error("expected mounted field editor");
    }

    const handled = handleEditorDocumentKeyDown({
      event: new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
      editor,
      fieldEditor,
      root: wrapper.element as HTMLElement,
    });
    expect(handled).toBe(true);

    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-2", offset: 0 },
      focus: { blockId: "paragraph-2", offset: 0 },
    });

    wrapper.unmount();
    editor.destroy();
  });

  it("SEC1: javascript: / data:text/html image src is inert", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "image-js",
          type: "image",
          props: {
            src: "javascript:alert(1)",
            alt: "hostile js",
          },
        },
        {
          id: "image-html",
          type: "image",
          props: {
            src: "data:text/html,<script>alert(1)</script>",
            alt: "hostile html",
          },
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const images = wrapper.findAll("img");
    expect(images).toHaveLength(2);

    for (const image of images) {
      expect(image.attributes("src")).toBeUndefined();
      expect(image.attributes("data-pen-blocked-url")).toBe("");
    }

    expect(wrapper.html()).not.toContain("javascript:");
    expect(wrapper.html()).not.toContain("data:text/html");

    wrapper.unmount();
    editor.destroy();
  });

  it("renders validated block text alignment", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-centered",
          type: "paragraph",
          props: { textAlignment: "center" },
          content: "Centered",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    expect(
      wrapper.get('[data-block-id="paragraph-centered"]').attributes("style"),
    ).toContain("text-align: center");

    wrapper.unmount();
    editor.destroy();
  });

  it("DIR2: sets dir on the block content host from props.direction ltr or rtl", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-ltr",
          type: "paragraph",
          props: { direction: "ltr" },
          content: "Hello",
        },
        {
          id: "paragraph-rtl",
          type: "paragraph",
          props: { direction: "rtl" },
          content: "مرحبا",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    expect(
      wrapper.get('[data-block-id="paragraph-ltr"]').attributes("dir"),
    ).toBe("ltr");
    expect(
      wrapper.get('[data-block-id="paragraph-rtl"]').attributes("dir"),
    ).toBe("rtl");

    wrapper.unmount();
    editor.destroy();
  });

  it("DIR2: omits dir when props.direction is missing or auto", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-none",
          type: "paragraph",
          props: {},
          content: "Plain",
        },
        {
          id: "paragraph-auto",
          type: "paragraph",
          props: { direction: "auto" },
          content: "Auto",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    expect(
      wrapper.get('[data-block-id="paragraph-none"]').attributes("dir"),
    ).toBeUndefined();
    expect(
      wrapper.get('[data-block-id="paragraph-auto"]').attributes("dir"),
    ).toBeUndefined();
    expect(wrapper.html()).not.toContain('dir="auto"');

    wrapper.unmount();
    editor.destroy();
  });

  it("DIR2: nested blocks set dir independently", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "quote-ltr",
          type: "blockquote",
          props: { direction: "ltr" },
          content: "Outer",
        },
        {
          id: "paragraph-rtl",
          type: "paragraph",
          props: { direction: "rtl", parentId: "quote-ltr" },
          content: "Inner",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    expect(wrapper.get('[data-block-id="quote-ltr"]').attributes("dir")).toBe(
      "ltr",
    );
    expect(
      wrapper.get('[data-block-id="paragraph-rtl"]').attributes("dir"),
    ).toBe("rtl");

    wrapper.unmount();
    editor.destroy();
  });

  it("AX1: content host is a multiline textbox", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Hello Vue",
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
    expect(wrapper.get("[data-pen-editor-content]").attributes("role")).toBeUndefined();
    expect(wrapper.get("[data-block-id]").attributes("role")).toBeUndefined();

    wrapper.unmount();
    editor.destroy();
  });

});
