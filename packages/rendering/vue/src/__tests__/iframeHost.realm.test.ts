// @vitest-environment jsdom

import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A Vue editor mounted into an iframe's document: the host's pointer
 * activation (`handleFieldEditorPointerActivate`) runs on events from the
 * iframe's realm, whose constructors the host window's do not recognise.
 */
describe("PenEditor mounted in an iframe document", () => {
  it("T5: a click on a paragraph in the iframe activates its field", async () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const frameDocument = iframe.contentDocument!;
    const frameWindow = iframe.contentWindow as Window & typeof globalThis;
    const container = frameDocument.createElement("div");
    frameDocument.body.append(container);
    const editor = createTestEditor({
      blocks: [
        { id: "paragraph-1", type: "paragraph", props: {}, content: "First" },
        { id: "paragraph-2", type: "paragraph", props: {}, content: "Second" },
      ],
    });
    const wrapper = mount(PenEditor, {
      attachTo: container,
      props: { editor },
    });
    await nextTick();

    const secondInline = frameDocument.querySelectorAll(
      "[data-pen-inline-content]",
    )[1]!;
    secondInline.dispatchEvent(
      new frameWindow.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-2" },
    });

    wrapper.unmount();
    editor.destroy();
  });
});
