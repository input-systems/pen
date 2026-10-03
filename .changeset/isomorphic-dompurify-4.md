---
"@input/pen-interop": patch
---

Update the HTML sanitizer's `isomorphic-dompurify` dependency from `~2.36.0` to `~4.3.0`, still pinned to a patch range (SEC7). The sanitizer's tag and attribute allowlist and its output are unchanged. On Node the wrapper now builds its window with jsdom 30; the matching `engines.node` change is in its own changeset.
