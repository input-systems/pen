---
"@input/pen-dom": minor
"@input/pen-react": minor
"@input/pen-vue": minor
---

Pen draws carets, remote carets and block outlines into one overlay layer per editor root, which the DOM scheduler paints. React's caret overlays are now bindings over it, and Vue gets the overlay with no component.

- Each editor root holds one `data-pen-overlay-layer` element as its last child. `getRootOverlay(root)` exposes the paint plan and the contributor API.
- The overlay caret is on by default on every surface. It draws carets beside mentions and inline apps, in empty blocks, and at range endpoints. Block and grid-cell selections get a library outline.
- New tokens: `--pen-overlay-z-index`, `--pen-editor-endpoint-caret-color`, `--pen-block-selection-outline`, `--pen-block-selection-background`, `--pen-block-selection-radius`, `--pen-selection-range-background` and `--pen-selection-range-opacity`.
- The editor root is the layer's containing block (OV2). The chrome stylesheet gives it `position: relative` at zero specificity, and a static root gets it inline while attached.
- `Pen.Editor.CaretOverlay` switches the root to `customCaret` mode, and pen-dom paints the caret. The blink restarts on each edit and caret move.
- `Pen.Multiplayer.CaretOverlay` registers the remote-caret contributor. Remote carets stay on their text inside transformed ancestors, and the binding drops its `MutationObserver`, rAF loop and scroll listeners.
- `EditorSelectionRect` draws only the region-selection marquee.

Host migration:

- Host CSS that targets the editor root's `:last-child` accounts for the `data-pen-overlay-layer` element.
- Hosts that already style `[data-selected]` set `--pen-block-selection-outline: none` on the editor root (or drop their rule) to avoid a double outline.
- Set caret and outline tokens (`--pen-editor-caret-*` included) on the editor root or above, not on a wrapper inside it.
- Scope `[data-block-id]` selectors to `[data-pen-editor-block]` if they must not match overlay items.
- Absolutely positioned host elements inside a static editor root now position against the root. Give the root its own non-static `position` to keep another containing block.
- `renderCaret` (editor and multiplayer) and `renderLabel` position from the `transform` in `caretStyle` / `labelStyle`, not `left` / `top`. Their nodes are portaled into the overlay layer, and `renderCaret` receives `affinity`.
- Hosts that style `[data-pen-editor-caret-overlay][data-caret-visible]` target `[data-pen-overlay-layer][data-caret-visible]`.
- Remote carets move from the `[data-pen-multiplayer-caret-overlay]` host into the layer. Restyle them under `[data-pen-overlay-layer] [data-pen-multiplayer-caret]`. They change from `position: fixed` with `left` / `top` to `position: absolute` with a `transform`. The default label is a child of its caret and no longer carries `data-pen-multiplayer-caret` or the user attributes.
- Hosts that relied on `EditorSelectionRect` to draw a committed block selection style `--pen-block-selection-outline` / `--pen-block-selection-background` on the editor root instead.

Breaking: yes — hosts update `:last-child`, `[data-selected]`, caret-overlay and remote-caret CSS for the root's `data-pen-overlay-layer`, position custom `renderCaret`/`renderLabel` output from `transform`, set tokens on the root, and give the root its own `position` if it must not be the containing block
