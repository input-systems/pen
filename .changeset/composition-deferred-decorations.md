---
"@input/pen-dom": patch
---

Render a decoration change that arrived during a composition when the composition closes without changing text. Both single-field backends defer decoration rebuilds while a composition holds the field, but a cancelled or empty-committed composition took the no-change path (the contenteditable caret restore, the EditContext drop with the field untouched) and never rebuilt, so the field kept its old decorations until the next edit. The close now rebuilds whenever the decorations render differently from the field's last build.

Breaking: no
