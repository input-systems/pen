import {
	ariaReadOnlyFacet,
	resolveEditorA11yLabel,
	resolveEditorMessage,
} from "@input/pen-core";
import { htmlImporter } from "@input/pen-interop/html";
import {
	adoptEditorChrome,
	bindEditorDocumentKeyDown,
	FieldEditorImpl,
	handleFieldEditorRootFocus,
	handleFieldEditorPointerActivate,
	registerVerticalCaretMeasure,
	resolveSelectAllBehavior,
} from "@input/pen-dom";
import {
	buildDataAttributes,
	DATA_ATTRS,
} from "@input/pen-dom/utils/dataAttributes";
import type {
	AssetProvider,
	Editor,
	InteractionModel,
} from "@input/pen-types";
import { FIELD_EDITOR_SLOT_KEY } from "@input/pen-types";
import {
	computed,
	defineComponent,
	h,
	mergeProps,
	onBeforeUnmount,
	onMounted,
	onUpdated,
	ref,
	toRef,
	watch,
	type ComponentPublicInstance,
	type PropType,
} from "vue";
import { useDocumentEmptyState } from "../internal/editorState";
import { provideEditorContext } from "../internal/editorContext";
import {
	provideFieldEditorContext,
	type VueFieldEditor,
} from "../internal/fieldEditorContext";
import type { PasteImporters, RendererOverrides } from "../types";
import { PenContent } from "./PenContent";

/**
 * The editor root. Owns the field editor, key handling, paste importers,
 * and focus state, and provides the editor context every other Pen
 * component and composable reads — so it must wrap them.
 *
 * Renders `PenContent` by default; supplying a default slot replaces
 * that, and the slot content is then responsible for rendering the
 * document.
 */
export const PenEditor = defineComponent({
	name: "PenEditor",
	props: {
		editor: {
			type: Object as PropType<Editor>,
			required: true,
		},
		readonly: {
			type: Boolean,
			default: false,
		},
		interactionModel: {
			type: String as PropType<InteractionModel | undefined>,
			default: undefined,
		},
		importers: {
			type: Object as PropType<PasteImporters | undefined>,
			default: undefined,
		},
		chrome: {
			type: Boolean,
			default: true,
		},
		assets: {
			type: Object as PropType<AssetProvider | undefined>,
			default: undefined,
		},
		emptyPlaceholder: {
			type: String,
			default: undefined,
		},
		renderers: {
			type: Object as PropType<RendererOverrides | undefined>,
			default: undefined,
		},
	},
	setup(props, { attrs, slots }) {
		const focused = ref(false);
		const rootElement = ref<HTMLElement | null>(null);
		const readonlyRef = toRef(props, "readonly");
		const emptyPlaceholderRef = computed(
			() =>
				props.emptyPlaceholder ??
				resolveEditorMessage(
					props.editor,
					"pen.schema.document.emptyPlaceholder",
				),
		);
		const renderersRef = toRef(props, "renderers");
		const fieldEditor = new FieldEditorImpl(props.editor, {
			selectAllBehavior: resolveSelectAllBehavior(
				props.interactionModel ?? "content-first",
			),
		}) as VueFieldEditor;
		const isDocumentEmpty = useDocumentEmptyState(props.editor);

		provideEditorContext({
			editor: props.editor,
			readonly: readonlyRef,
			emptyPlaceholder: emptyPlaceholderRef,
			renderers: renderersRef,
		});
		provideFieldEditorContext(fieldEditor);

		props.editor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);

		watch(
			() => [props.chrome, rootElement.value] as const,
			([chrome, root], _previous, onCleanup) => {
				if (chrome === false) {
					return;
				}
				const doc =
					root?.ownerDocument ??
					(typeof document !== "undefined" ? document : undefined);
				if (!doc) {
					return;
				}
				const releaseChrome = adoptEditorChrome(doc);
				onCleanup(() => {
					releaseChrome();
				});
			},
			{ immediate: true },
		);

		watch(
			() => props.interactionModel,
			(interactionModel) => {
				fieldEditor.setSelectAllBehavior(
					resolveSelectAllBehavior(interactionModel ?? "content-first"),
				);
			},
		);

		watch(
			rootElement,
			(nextElement, _previousElement, onCleanup) => {
				fieldEditor.setRootElement(nextElement);
				if (!nextElement) {
					focused.value = false;
					fieldEditor.setFocused(false);
					return;
				}

				const unregisterVerticalCaret = registerVerticalCaretMeasure(
					props.editor,
					nextElement,
				);

				const handleFocusIn = (event: FocusEvent) => {
					focused.value = true;
					fieldEditor.setFocused(true);
					handleFieldEditorRootFocus({
						event,
						editor: props.editor,
						fieldEditor,
						root: nextElement,
						readonly: props.readonly,
					});
				};

				const handleFocusOut = () => {
					const activeElement =
						nextElement.ownerDocument?.activeElement;
					const nextFocused =
						activeElement instanceof Node &&
						nextElement.contains(activeElement);
					focused.value = nextFocused;
					fieldEditor.setFocused(nextFocused);
				};

				const unbindDocumentKeys = bindEditorDocumentKeyDown({
					editor: props.editor,
					fieldEditor,
					root: nextElement,
					getInteractionModel: () =>
						props.interactionModel ?? "content-first",
				});

				const handlePointerActivate = (event: MouseEvent) => {
					const blocksHost = nextElement.querySelector(
						`[${DATA_ATTRS.editorBlocksHost}]`,
					);
					if (!(blocksHost instanceof HTMLElement)) {
						return;
					}
					handleFieldEditorPointerActivate({
						event,
						editor: props.editor,
						fieldEditor,
						root: nextElement,
						blocksHost,
						readonly: props.readonly,
					});
				};

				nextElement.addEventListener("focusin", handleFocusIn);
				nextElement.addEventListener("focusout", handleFocusOut);
				nextElement.addEventListener("mousedown", handlePointerActivate);
				onCleanup(() => {
					nextElement.removeEventListener("focusin", handleFocusIn);
					nextElement.removeEventListener("focusout", handleFocusOut);
					nextElement.removeEventListener(
						"mousedown",
						handlePointerActivate,
					);
					unbindDocumentKeys();
					unregisterVerticalCaret();
				});
			},
			{ immediate: true },
		);

		watch(
			() => [props.importers, props.assets] as const,
			([importers, assets]) => {
				props.editor.internals.assignSlot("paste:importers", {
					...importers,
					html: importers?.html ?? htmlImporter,
				});
				props.editor.internals.assignSlot(
					"paste:assetProvider",
					assets ?? importers?.assets,
				);
			},
			{ immediate: true },
		);

		const ackMountedBlocks = () => {
			const root = rootElement.value;
			if (!root) {
				return;
			}
			for (const element of root.querySelectorAll(
				`[${DATA_ATTRS.editorBlock}]`,
			)) {
				if (!(element instanceof HTMLElement)) {
					continue;
				}
				const blockId = element.getAttribute(DATA_ATTRS.blockId);
				if (blockId) {
					fieldEditor.ackBlockMounted(blockId, element);
				}
			}
		};
		onMounted(ackMountedBlocks);
		onUpdated(ackMountedBlocks);

		onBeforeUnmount(() => {
			props.editor.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, undefined);
			props.editor.internals.assignSlot("paste:importers", undefined);
			props.editor.internals.assignSlot("paste:assetProvider", undefined);
			fieldEditor.setRootElement(null);
			fieldEditor.destroy();
		});

		return () => {
			const children = slots.default ? slots.default() : [h(PenContent)];

			return h(
				"div",
				mergeProps(attrs, {
					ref: (
						element: Element | ComponentPublicInstance | null,
					) => {
						rootElement.value =
							element instanceof HTMLElement ? element : null;
					},
					[DATA_ATTRS.editorRoot]: "",
					[DATA_ATTRS.viewId]: props.editor.internals.viewId,
					...buildDataAttributes({
						[DATA_ATTRS.focused]: focused.value,
						[DATA_ATTRS.readonly]: props.readonly,
						[DATA_ATTRS.empty]: isDocumentEmpty.value,
					}),
					tabIndex: focused.value ? -1 : 0,
					role: "textbox",
					"aria-multiline": "true",
					...resolveEditorA11yLabel(props.editor),
					"aria-readonly":
						props.readonly ||
						props.editor.facet(ariaReadOnlyFacet) ||
						undefined,
				}),
				children,
			);
		};
	},
});
