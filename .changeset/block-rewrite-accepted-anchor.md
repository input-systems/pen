---
"@input/pen-ai": patch
---

Re-anchor an inline turn that rewrites blocks on the paragraphs it staged, instead of leaving it on the blocks it replaced. A block-range replacement deletes its own target blocks, so the session, its turn, and the contextual prompt were left pointing at a block that no longer exists once the turn settled, and a host positioning its prompt UI from that anchor fell back to the top of the document.
