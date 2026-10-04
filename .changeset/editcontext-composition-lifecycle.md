---
"@input/pen-dom": patch
---

C4: EditContext IME compositions with more than one update no longer lose or corrupt text. A composition now has one lifecycle — it opens on the EditContext's `compositionstart`, stays open across every `textupdate`, and commits once at `compositionend` over the range it replaced — instead of committing and reopening on alternate updates, which deleted the text after the caret (pinyin, Korean, and Japanese over a selection), left a phantom composition open, and corrupted the field when a collaborator edited mid-composition. While composing, the composed text is painted into the field without entering the document, so the selection record no longer points into text the document does not hold; collaborator, host, and history edits are deferred and the commit rebases over them with the contenteditable backend's Yjs placement. Blurring or clicking away mid-composition keeps the composed text. Typing no longer duplicates each edit in the EditContext buffer: the buffer follows the document by diff.

Breaking: no
