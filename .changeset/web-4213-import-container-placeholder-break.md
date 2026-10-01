---
"@input/pen-interop": patch
---

Import the inline content of a block container such as `<div>` as one paragraph, keeping its marks and `<br>` line breaks, instead of one paragraph per child with the breaks dropped. A container whose only content is a `<br>` (the Gmail and Apple Mail blank line, `<div><br></div>`) now imports as an empty paragraph, and source formatting whitespace between a container's inline children no longer becomes a line break. A `<br>` that ends any block's content, `<p>` included, no longer imports as a trailing newline, matching how browsers render it.
