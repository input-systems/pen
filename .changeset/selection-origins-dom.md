---
"@input/pen-dom": minor
---

Selection writes from pen-dom now carry their real origin (S3): pointer gestures, drops and context-menu or drag pastes write `pointer`; keymap commands, text input and shortcut pastes write `keyboard`, or `ime` while composing. Keyboard caret moves therefore scroll into view. `FieldEditorStore.applyDocumentTextSelection` and `applyDomTextSelection` take a required `origin` argument, and `destructureInlineAtom` and `collapseSelectionToPoint` take an optional one.

Breaking: yes — hosts that call `applyDocumentTextSelection` or `applyDomTextSelection` pass the gesture's origin, e.g. `"pointer"`
