---
"@input/pen-react": patch
"@input/pen-core": patch
"@input/pen-types": patch
---

`useSuggestionMenu` no longer blanks an open menu on every keystroke. A synchronous `getItems` result is applied in the same state update that opens or retargets the menu, with no intermediate `loading` render. For an async `getItems`, a refined query on the same trigger keeps the previous `items` while `status` is `loading`, then swaps in its own; stale responses are still dropped. A `getItems` that throws synchronously now lands in the `error` state instead of escaping the refresh. `@input/pen-types` exports the `isPromiseLike` guard, which the hook and core's extension lifecycle now share.

Breaking: no
