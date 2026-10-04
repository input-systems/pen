---
"@input/pen-dom": patch
---

Keep authority projections from taking focus the editor does not own (HOST9), make the projection and focus paths work for editors mounted in an iframe, and project a multi-block range when focus enters the root.

- A `programmatic`, `mapped` (collaborator or AI edit) or `gc` selection write no longer moves focus into an editor while focus is elsewhere: in another editor on the same page, on the document body after a blur, or on a host button. The record still updates and projects once the editor owns focus again. `pointer`, `keyboard`, `ime` and `restore` writes, and a `mapped` record from the editor's own `user` commit, still take focus from the body or host chrome; nothing takes it from a native text control or another editor. A remote text change no longer writes an unfocused EditContext field's native range, and a surface switch for a withheld record attaches without focus.
- Focus, event-target and read-back checks no longer use the host window's `Node` / `Element` / `HTMLElement` constructors, so HOST9 withholding, P3, the W3.R1 read-back and root pointer gestures work when the editor's document is an iframe's.
- Tab (or a host `focus()`) into the root with a multi-block text range within the block-surface threshold now projects it into the expanded host (S2), so printable keys reach it. New `FieldEditorSession.focusSelection()` performs that activation.

Breaking: no
