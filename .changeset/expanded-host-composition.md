---
"@input/pen-dom": patch
---

Fix a Firefox crash when a composition starts over a cross-block selection. Firefox cannot cancel `insertCompositionText`, so a composition in the expanded host moved text out of the end block and removed block elements the renderer owns, and React's next commit threw `Node.removeChild` (DOM fuzzer seed 23). The expanded host now hands a composition keystroke to the caret's field after deleting the range, and a composition with no keystroke before it (Gecko's text input processor) composes at the collapsed range start and replaces the range with the committed text at `compositionend`.

Breaking: no
