// @vitest-environment jsdom

import { fieldEditorHostFacet } from "@input/pen-core";
import type { FieldEditorImpl } from "@input/pen-dom";
import { createTestEditor } from "@input/pen-test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("PenEditor focus follows the window (O5)", () => {
  it("an inactive window unfocuses the field while activeElement stays in the root", async () => {
    const editor = createTestEditor({
      blocks: [{ id: "p1", type: "paragraph", props: {}, content: "Hello" }],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const wrapper = mount(PenEditor, { props: { editor }, attachTo: host });
    await nextTick();
    const root = wrapper.element as HTMLElement;
    const fieldEditor = editor.facet(fieldEditorHostFacet) as FieldEditorImpl;
    const inner = document.createElement("button");
    root.append(inner);
    inner.focus();
    expect(fieldEditor.isFocused).toBe(true);

    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    window.dispatchEvent(new FocusEvent("blur"));
    await nextTick();
    expect(document.activeElement).toBe(inner);
    expect(fieldEditor.isFocused).toBe(false);
    expect(root.hasAttribute("data-focused")).toBe(false);

    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new FocusEvent("focus"));
    expect(fieldEditor.isFocused).toBe(true);

    wrapper.unmount();
    editor.destroy();
  });
});
