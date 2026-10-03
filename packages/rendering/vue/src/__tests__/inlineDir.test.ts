// @vitest-environment jsdom

import { createTestEditor } from "@input/pen-test";
import type { Editor } from "@input/pen-types";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { PenEditor } from "../components/PenEditor";
import { PenInlineContent } from "../components/PenInlineContent";
import { provideEditorContext } from "../internal/editorContext";
import { provideFieldEditorContext } from "../internal/fieldEditorContext";

afterEach(() => {
  document.body.replaceChildren();
});

function mountInlineContent(args: {
  editor: Editor;
  blockId: string;
  direction?: string;
}) {
  const Harness = defineComponent({
    setup() {
      provideEditorContext({
        editor: args.editor,
        readonly: ref(false),
        emptyPlaceholder: ref(undefined),
        renderers: ref(undefined),
        rootElement: ref(null),
      });
      provideFieldEditorContext(null);
      return () =>
        h(PenInlineContent, {
          blockId: args.blockId,
          ...(args.direction !== undefined
            ? { direction: args.direction }
            : {}),
        });
    },
  });

  return mount(Harness, { attachTo: document.body });
}

describe("PenInlineContent DIR2", () => {
  it("DIR2: sets dir from direction prop when ltr or rtl", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-ltr",
          type: "paragraph",
          props: {},
          content: "Hello",
        },
        {
          id: "paragraph-rtl",
          type: "paragraph",
          props: {},
          content: "مرحبا",
        },
      ],
    });

    const ltrWrapper = mountInlineContent({
      editor,
      blockId: "paragraph-ltr",
      direction: "ltr",
    });
    const rtlWrapper = mountInlineContent({
      editor,
      blockId: "paragraph-rtl",
      direction: "rtl",
    });

    expect(ltrWrapper.get("[data-pen-inline-content]").attributes("dir")).toBe(
      "ltr",
    );
    expect(rtlWrapper.get("[data-pen-inline-content]").attributes("dir")).toBe(
      "rtl",
    );

    ltrWrapper.unmount();
    rtlWrapper.unmount();
    editor.destroy();
  });

  it("DIR2: omits dir when direction prop is missing or auto", () => {
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
          props: {},
          content: "Auto",
        },
      ],
    });

    const noneWrapper = mountInlineContent({
      editor,
      blockId: "paragraph-none",
    });
    const autoWrapper = mountInlineContent({
      editor,
      blockId: "paragraph-auto",
      direction: "auto",
    });

    expect(
      noneWrapper.get("[data-pen-inline-content]").attributes("dir"),
    ).toBeUndefined();
    expect(
      autoWrapper.get("[data-pen-inline-content]").attributes("dir"),
    ).toBeUndefined();
    expect(autoWrapper.html()).not.toContain('dir="auto"');

    noneWrapper.unmount();
    autoWrapper.unmount();
    editor.destroy();
  });

  it("DIR2: sets dir on the inline content host from block props.direction", () => {
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
      wrapper
        .get('[data-block-id="paragraph-ltr"] [data-pen-inline-content]')
        .attributes("dir"),
    ).toBe("ltr");
    expect(
      wrapper
        .get('[data-block-id="paragraph-rtl"] [data-pen-inline-content]')
        .attributes("dir"),
    ).toBe("rtl");

    wrapper.unmount();
    editor.destroy();
  });
});
