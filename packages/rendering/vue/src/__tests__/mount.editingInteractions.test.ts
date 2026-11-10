// @vitest-environment jsdom

import { FIELD_EDITOR_SLOT_KEY } from "@input/pen-types";
import { createTestEditor } from "@input/pen-test";
import { undoExtension } from "@input/pen-undo";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * HOST9: keys reach the editor only while it has focus, and a browser
 * dispatches a keydown on the focused element.
 */
async function pressInFocusedEditor(root: HTMLElement, key: string) {
  if (!root.contains(document.activeElement)) {
    root.focus();
    await nextTick();
  }
  expect(root.contains(document.activeElement)).toBe(true);
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  await nextTick();
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
    extensions: [undoExtension()],
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

describe("@input/pen-vue: editing interactions", () => {
  it("transitions from text editing to block selection on Escape", async () => {
    const editor = createParagraphEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });
    await nextTick();

    const firstInline = wrapper.findAll("[data-pen-inline-content]")[0]!;
    await firstInline.trigger("mousedown");
    await firstInline.trigger("click");
    await nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "block",
      blockIds: ["paragraph-1"],
    });

    wrapper.unmount();
    editor.destroy();
  });

  it("selects all content with the first Mod-A", async () => {
    const editor = createParagraphEditor();
    editor.selectText("paragraph-1", 0, 0);

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });
    await pressInFocusedEditor(wrapper.element as HTMLElement, "a");

    // The default interaction model is content-first, so T1 enters at the
    // content rung: one press spans every block.
    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-1", offset: 0 },
      focus: { blockId: "paragraph-2", offset: 6 },
    });

    await pressInFocusedEditor(wrapper.element as HTMLElement, "a");

    expect(editor.selection).toEqual({
      type: "block",
      blockIds: ["paragraph-1", "paragraph-2"],
      head: "paragraph-2",
    });

    wrapper.unmount();
    editor.destroy();
  });

  it("undoes text changes with Mod-Z", async () => {
    const editor = createParagraphEditor();
    editor.selectText("paragraph-1", 5, 5);
    editor.replaceSelection("!");

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });
    await pressInFocusedEditor(wrapper.element as HTMLElement, "z");

    expect(editor.getBlock("paragraph-1")?.textContent()).toBe("First");

    wrapper.unmount();
    editor.destroy();
  });

  it("applies inline typing through the active field editor", async () => {
    const editor = createParagraphEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const firstInline = wrapper.findAll("[data-pen-inline-content]")[0]!;
    await firstInline.trigger("mousedown");
    await firstInline.trigger("click");
    await nextTick();

    const activeSurface = wrapper.get("[data-pen-field-editor-active-surface]");
    // W3.R5: input edits the authority; a caret moved in the DOM with no
    // gesture is divergence and is projected back (R step 4).
    editor.selectText("paragraph-1", 5, 5);
    await nextTick();
    dispatchBeforeInput(activeSurface.element as HTMLElement, {
      inputType: "insertText",
      data: "!",
    });
    await nextTick();

    expect(editor.getBlock("paragraph-1")?.textContent()).toBe("First!");

    wrapper.unmount();
    editor.destroy();
  });

  it("pastes plain text through the active field editor", async () => {
    const editor = createParagraphEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const firstInline = wrapper.findAll("[data-pen-inline-content]")[0]!;
    await firstInline.trigger("mousedown");
    await firstInline.trigger("click");
    await nextTick();

    const clipboardData = createClipboardData();
    clipboardData.setData("text/plain", " world");

    const activeSurface = wrapper.get("[data-pen-field-editor-active-surface]");
    editor.selectText("paragraph-1", 5, 5);
    await nextTick();
    setDomTextSelection(activeSurface.element as HTMLElement, 5);
    dispatchBeforeInput(activeSurface.element as HTMLElement, {
      inputType: "insertFromPaste",
      dataTransfer: clipboardData,
    });
    await flushTransfer();

    expect(editor.getBlock("paragraph-1")?.textContent()).toBe("First world");

    wrapper.unmount();
    editor.destroy();
  });
});
