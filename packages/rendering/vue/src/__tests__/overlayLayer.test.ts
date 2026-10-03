// @vitest-environment jsdom

import { fieldEditorHostFacet } from "@input/pen-core";
import { getRootOverlay, type FieldEditorImpl } from "@input/pen-dom";
import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
  document.body.replaceChildren();
});

describe("PenEditor overlay layer (W35.R2, W35.R5)", () => {
  it("OV2: PenEditor's root gets one overlay layer and the readonly prop reaches the field editor", async () => {
    const editor = createTestEditor({
      blocks: [{ id: "p1", type: "paragraph", props: {}, content: "Hello" }],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const wrapper = mount(PenEditor, {
      props: { editor, readonly: true },
      attachTo: host,
    });
    await nextTick();

    const root = wrapper.element as HTMLElement;
    const layers = root.querySelectorAll("[data-pen-overlay-layer]");
    expect(layers).toHaveLength(1);
    expect(root.lastElementChild).toBe(layers[0]);
    expect(getRootOverlay(root)?.layer).toBe(layers[0]);

    const fieldEditor = editor.facet(fieldEditorHostFacet) as FieldEditorImpl;
    expect(fieldEditor.isReadOnly).toBe(true);
    await wrapper.setProps({ readonly: false });
    expect(fieldEditor.isReadOnly).toBe(false);

    wrapper.unmount();
    expect(root.querySelector("[data-pen-overlay-layer]")).toBeNull();
    editor.destroy();
  });
});
