---
"@input/pen-interop": patch
"@input/pen-dom": patch
---

HTML import no longer drops pasted text.

- Nested lists from Slack, Apple Notes and Google Docs keep every item at the right indent.
- Block content wrapped in an inline element (Google Docs' outer `<b>`) stays as separate blocks.
- Table captions and text outside `<code>` in a `<pre>` are kept.
- A conversion that would still lose text falls back to plain paragraphs or the literal clipboard text.
- The sanitizer's `isomorphic-dompurify` moves from `~2.36.0` to `~4.3.0`. Its allowlist and output are unchanged (SEC7).

Breaking: no
