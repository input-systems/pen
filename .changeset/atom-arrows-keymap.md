---
"@input/pen-dom": minor
---

Arrow keys beside inline atoms go through the keymap like every other caret key: the DOM-range arrow path (`selectInlineAtomWithArrowKey`) is removed, so M2's swap applies in right-to-left blocks, the selection write carries origin `keyboard`, and the contenteditable keydown reads the selection authority instead of the live DOM range.

Breaking: yes — hosts that relied on ArrowLeft always meaning "previous atom" in right-to-left blocks get the visual direction instead; no API change
