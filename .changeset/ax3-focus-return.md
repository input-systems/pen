---
"@input/pen-react": minor
---

Focus returns by primitive class (AX3, D15). Toolbar buttons and toggles no longer take focus when clicked (the primary-button `pointerdown` and `mousedown` default is prevented after a host handler runs), keyboard activation keeps focus on the toolbar control, and Escape returns it to the editor. The selection toolbar returns focus to the editor when an action unmounts it. The block handle menu and the table column menu return focus to their invoking control (delete returns it to the editor surface). The AI command menu and the AI contextual prompt return focus on accept, reject, dismiss and Escape to whatever held it when they opened. Every return is synchronous; the block handle and table add-row/add-column `queueMicrotask` refocuses are gone.

Breaking: yes — hosts whose toolbar `onClick` handlers relied on the button holding focus (for example to read `document.activeElement`) read the editor selection instead, and hosts that refocused the editor themselves after the AI command menu or contextual prompt closed remove that refocus, because Pen now returns focus to the invoker
