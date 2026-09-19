---
"@input/pen-ai": patch
---

Add `scopeUnit` to proactive suggestions: `block` analyzes the whole dirty block, `document` analyzes every eligible block in one request and anchors each candidate in its own block, so edits in a second paragraph no longer drop the first paragraph's analysis. `blockPolicy.isBlockAllowed` lets hosts veto blocks beyond their type.
