---
"@input/pen-dom": patch
"@input/pen-react": patch
---

A collaborator's edit that arrives while an IME composes over a multi-block range no longer ends the composition. The edited blocks were rebuilt under the composition, so the browser dropped it without a `compositionend`, the editor stayed in its composing state, and the committed text left focus outside the editor. Those blocks now rebuild once the composition ends (C2).

Breaking: no
