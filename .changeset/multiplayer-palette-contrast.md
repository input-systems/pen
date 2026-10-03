---
"@input/pen-multiplayer": patch
---

The default peer palette (`MULTIPLAYER_COLORS`) moves to darker shades so the caret label's white text holds 4.5:1 on every entry (WCAG 1.4.3). Peers keep their palette slot; only the shade changes. Hosts that pass `user.color` are unaffected.

Breaking: no
