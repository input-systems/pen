---
"@input/pen-react": minor
---

`Pen.Multiplayer.CaretOverlay` is now a binding over `@input/pen-dom`'s overlay: while mounted it registers the remote-caret contributor, and `@input/pen-dom` measures each collaborator's caret in the scheduler's read phase and paints it, with its name label as a child, into the root's `data-pen-overlay-layer` with transforms. Remote carets stay on the text inside transformed or filtered ancestors, a moving caret keeps its element, and the binding no longer runs a `MutationObserver`, `requestAnimationFrame` loop, or scroll and resize listeners. With `renderCaret` or `renderLabel`, the host's nodes render in a `[data-pen-multiplayer-caret-overlay]` host portaled into the layer, with `caretStyle` and `labelStyle` positioned by `transform` (no `left`/`top`).

Breaking: yes — hosts restyle remote carets under `[data-pen-overlay-layer] [data-pen-multiplayer-caret]` and position custom `renderCaret`/`renderLabel` output from the `transform` in `caretStyle`/`labelStyle`: remote caret elements move from the `[data-pen-multiplayer-caret-overlay]` host into `[data-pen-overlay-layer]`; `position: fixed` with `left`/`top` becomes `position: absolute` with a `transform` in `caretStyle` and `labelStyle`; the default label is a child of its caret and no longer carries `data-pen-multiplayer-caret` or the user attributes.
