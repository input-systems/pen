---
"@input/pen-dom": minor
"@input/pen-react": minor
"@input/pen-vue": minor
---

List items are announced as lists (AX1): each run of list items renders inside a `div[data-pen-list-group][role="list"]`, and each item's block host carries `role="listitem"`, `aria-level`, `aria-posinset`, and `aria-setsize`, on React (`EditorContent`, `Pen.Editor.BlockChildren`), Vue (`PenContent`, `PenBlock`) and `mountEditor`. The block notifier's `list` slice now exists for every list item and carries `level`, `posinset`, `setsize` and `groupKey` beside `ordinal`; `getListSegments(parentId)` returns list groups. A click on a list group wrapper is host chrome, and region selection and click-outside-blocks find blocks inside groups.

List items now sit one element deeper, and an item that moves between groups when a run splits or merges is remounted by React and Vue. Host CSS that relies on `[data-pen-editor-block] + [data-pen-editor-block]` across a list boundary needs a `[data-pen-list-group]` selector too, and host code that walks the blocks host's direct children must also look inside `[data-pen-list-group]`.

Breaking: yes
