---
"@input/pen-dom": patch
---

Initialize editor root focus when binding, so focus that arrived before the listeners were installed is reflected in the field editor, caret overlay, and autocomplete eligibility across React, Vue, and vanilla mounts.

Breaking: no
