---
"@input/pen-core": patch
"@input/pen-dom": patch
"@input/pen-react": patch
---

Add `isSafeCssColor` to `@input/pen-core`, the COL2 colour grammar, and re-validate the peer colour wherever Pen writes `--pen-peer-color`: the overlay's remote caret and label styles and the React table cell ring fall back to `currentColor` for anything else. The remote caret and its label now paint the colour through `background-color` instead of the `background` shorthand, so a value that reached the variable cannot become an image fetch.

Breaking: no
