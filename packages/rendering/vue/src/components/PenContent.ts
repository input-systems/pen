import {
  buildDataAttributes,
  DATA_ATTRS,
} from "@input/pen-dom/utils/dataAttributes";
import { fieldEditorTextEntryAttrs } from "@input/pen-dom/utils/fieldEditorTextEntryAttrs";
import {
  computed,
  defineComponent,
  h,
  ref,
  watch,
  type ComponentPublicInstance,
  type PropType,
} from "vue";
import {
  useDocumentSnapshot,
  useSurfaceSnapshot,
} from "../internal/blockNotifier";
import { useEditorContext } from "../internal/editorContext";
import { useFieldEditorContext } from "../internal/fieldEditorContext";
import { PenBlock } from "./PenBlock";

/**
 * Renders the document's top-level blocks and hosts the text-entry
 * surface. Must appear inside a `PenEditor`, which provides the editor
 * context and the field editor this component attaches to.
 */
export const PenContent = defineComponent({
  name: "PenContent",
  props: {
    as: {
      type: String as PropType<string>,
      default: "div",
    },
  },
  setup(props) {
    const { editor } = useEditorContext();
    const fieldEditor = useFieldEditorContext();
    // List-level state only (SCALE6): root ids, emptiness, and whether the
    // surface is expanded. Each PenBlock acknowledges its own mount.
    const documentSnapshot = useDocumentSnapshot();
    const surface = useSurfaceSnapshot();
    const blockIds = computed(() => documentSnapshot.value.rootIds);
    const isEmpty = computed(() => documentSnapshot.value.isEmpty);
    const isExpanded = computed(() => surface.value.mode === "expanded");
    const expandedBlockIds = computed(() =>
      isExpanded.value ? surface.value.activeBlockIds : null,
    );
    const blocksHostElement = ref<HTMLElement | null>(null);

    watch(
      [blocksHostElement, isExpanded, expandedBlockIds],
      ([nextElement, nextIsExpanded]) => {
        if (nextElement && fieldEditor && nextIsExpanded) {
          fieldEditor.attachElement(nextElement);
        }
      },
      { immediate: true },
    );

    return () => {
      const blockNodes = blockIds.value.map((blockId) =>
        h(PenBlock, {
          key: blockId,
          blockId,
        }),
      );

      return h(
        props.as,
        {
          [DATA_ATTRS.editorContent]: "",
          ...buildDataAttributes({
            empty: isEmpty.value,
          }),
        },
        [
          h(
            "div",
            {
              ref: (element: Element | ComponentPublicInstance | null) => {
                blocksHostElement.value =
                  element instanceof HTMLElement ? element : null;
              },
              "data-pen-editor-blocks-host": "",
              ...(isExpanded.value
                ? {
                    [DATA_ATTRS.fieldEditorSurface]: "",
                    ...fieldEditorTextEntryAttrs(true, editor),
                  }
                : {}),
            },
            blockNodes,
          ),
        ],
      );
    };
  },
});
