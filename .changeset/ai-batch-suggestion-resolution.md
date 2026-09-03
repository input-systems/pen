---
"@input/pen-ai": patch
---

Export `acceptSuggestions` and `rejectSuggestions` from the package root. Hosts that stage persistent suggestions headlessly (`applySuggestedAIOperations`) can now resolve a chosen id set as one undo group under their own origin, instead of looping `acceptSuggestion` per id or resolving everything with `acceptAllSuggestions`.
