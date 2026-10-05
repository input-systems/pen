---
"@input/pen-core": minor
---

`resolveSuggestionMenuTarget` with `boundary: "whitespace"` now anchors on the last trigger that has whitespace (or the start of the lookbehind) before it, instead of rejecting when the last trigger character does not. A later trigger character becomes part of the query, so `@ada@example` resolves as one mention query rather than closing the menu at the second `@`. Hosts that relied on a second trigger character closing the menu, such as `:smile:`, should set `closingChar`. `boundary: "any"` is unchanged.

Breaking: yes — hosts whose `boundary: "whitespace"` trigger relied on a second trigger character closing the menu set `closingChar`
