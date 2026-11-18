---
"@input/pen-ai": patch
---

Autocomplete no longer shows a literal `\n` in the ghost. The cursor prompt JSON-encodes its context, so a model could answer in the same encoding; an escaped newline in a completion is now read as a line break outside code blocks, and both system prompts ask for plain text.

Breaking: no
