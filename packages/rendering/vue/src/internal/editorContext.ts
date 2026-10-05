import { inject, provide, type InjectionKey, type Ref } from "vue";
import type { Editor } from "@input/pen-types";
import type { RendererOverrides } from "../types";

export interface PenEditorContextValue {
  editor: Editor;
  readonly: Ref<boolean>;
  emptyPlaceholder: Ref<string | undefined>;
  renderers: Ref<RendererOverrides | undefined>;
  /** The editor root element once mounted: overlay bindings reach the root overlay through it. */
  rootElement: Ref<HTMLElement | null>;
}

const PEN_EDITOR_CONTEXT_KEY: InjectionKey<PenEditorContextValue> =
  Symbol("pen-vue-editor-context");

export function provideEditorContext(value: PenEditorContextValue): void {
  provide(PEN_EDITOR_CONTEXT_KEY, value);
}

export function useEditorContext(): PenEditorContextValue {
  const context = inject(PEN_EDITOR_CONTEXT_KEY, null);
  if (!context) {
    throw new Error("Missing PenEditor context");
  }
  return context;
}
