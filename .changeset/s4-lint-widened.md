---
"@input/pen-dom": patch
"@input/pen-react": patch
---

S4: `FieldEditor.focusTextSelection` and the React focus controller (`useFocusController`) no longer defer: the selection write, attachment check, and focus run in the calling turn, and the returned promise is already settled. The signatures are unchanged (`Promise<boolean>`). The `no-selection-timers` lint now also bans `queueMicrotask`, `requestIdleCallback`, `Promise.resolve().then`, `async`/`await`, setter-calling scheduler callbacks, and retry counters across the widened selection module list.

Breaking: no
