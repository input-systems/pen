---
"@input/pen-dom": patch
---

An undo or redo that rebuilds the active field now projects the selection through the projector instead of writing the native range itself (S1, P3). The contenteditable and EditContext backends wrote it directly, so an undo triggered while focus sat on editor chrome (a toolbar button reached by keyboard) or on a host control took focus from it; the projector withholds that write under HOST9 and while chrome holds focus, and the next projection that finds focus in the field writes it. The EditContext buffer still takes the restored selection.

Breaking: no
