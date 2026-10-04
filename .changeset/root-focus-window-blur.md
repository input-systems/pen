---
"@input/pen-dom": patch
"@input/pen-react": patch
"@input/pen-vue": patch
---

The overlay caret stops painting while the window is inactive (O5). Alt-tabbing away left `document.activeElement` inside the editor root, so `mountEditor`, `Pen.Editor.Root`, and Vue's `PenEditor` kept the field focused. All three now track root focus through a new pen-dom helper, `bindEditorRootFocus` (with `isEditorRootFocused`), which also follows the window's `blur` and `focus` and checks `document.hasFocus()`.

Breaking: no
