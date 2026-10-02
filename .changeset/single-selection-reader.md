---
"@input/pen-dom": patch
---

The field editor reads the DOM selection through one `selectionchange` listener per editor root, bound when the root element is set, instead of one listener per input backend (S1). A selection made in the editor while no field is attached is now read like any other, and the context-menu gesture window opens from the root. `domSelectionToEditor` accepts the `Selection` to map as an optional second argument.

Breaking: no
