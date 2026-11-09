---
"@input/pen-dom": patch
---

Document keys now follow focus (HOST9). While a host element beside the editor holds focus, the editor's document key handler takes no keys, whatever selection it was left with. Before, a leftover block or cell selection let the editor claim the key: arrow keys in a focused host menu moved the block selection instead of the menu's focus, Tab moved the cell selection instead of reaching the next host control, Enter on a focused host button inserted a paragraph and cancelled the click, Backspace and Delete deleted the selected blocks, and Escape escalated the editor's selection. On a body that focus fell to, every key now goes to the editor only if it held focus last, as Mod-a and history already did.

Graded patch, as earlier HOST9 changes were. Focus inside the editor, on a wrapper of it, or on a body it lost focus to routes keys as before.

Breaking: no
