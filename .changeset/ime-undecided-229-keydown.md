---
"@input/pen-dom": patch
---

A `keyCode` 229 keydown with `key` "Unidentified" (an Android virtual keyboard's report for every key, Backspace and Enter included) no longer deletes a cross-block range on its own: in the expanded host the `beforeinput` or `compositionstart` that follows decides, so Backspace deletes only the range; the D5 focus sink leaves it alone (FE2, D20).

Breaking: no
