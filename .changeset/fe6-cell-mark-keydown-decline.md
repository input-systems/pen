---
"@input/pen-dom": patch
---

FE6: `Mod-b`/`Mod-i`/`Mod-u` inside an edited table cell now fail closed on keydown when no keymap command or binding claims them — the default is prevented and `cell-capability-unsupported` (`capability: "marks"`) is emitted once. Previously the decline waited for a native `formatBold` `beforeinput`, which Firefox never sends and WebKit only sends when the host app maps the key equivalent, so the decline was silent outside Chromium. The `beforeinput` route still reports for toggles that arrive without that keydown.

Breaking: no
