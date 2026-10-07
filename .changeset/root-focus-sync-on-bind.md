---
"@input/pen-dom": patch
"@input/pen-react": patch
---

Initialize editor root focus when binding, so focus that arrived before the listeners were installed is reflected in the field editor, caret overlay, and autocomplete eligibility across React, Vue, and vanilla mounts.

Skip unchanged React focus state updates so the initial focus report preserves existing mount render counts.

Breaking: no
