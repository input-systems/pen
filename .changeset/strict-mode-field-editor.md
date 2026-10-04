---
"@input/pen-dom": patch
"@input/pen-react": patch
---

Keep the field editor live under React Strict Mode. `EditorRoot` destroyed its field editor in an effect cleanup and reused the same instance when Strict Mode ran the effect again, so the P1 selection listener, the commit feed, the history listener and the session reconciler stayed detached: selection writes no longer projected and remote edits no longer reconciled. `FieldEditorImpl.connect()` re-attaches what `destroy()` released (a no-op while connected), and `EditorRoot` calls it in the effect whose cleanup destroys.

Breaking: no
