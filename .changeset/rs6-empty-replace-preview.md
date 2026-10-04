---
"@input/pen-ai": patch
---

Preview `replace_block_text` with empty text as clearing the block (RS6). The review preview treated any empty text as "nothing arrived yet" and withdrew the operation's preview, so a replacement with `text: ""` previewed nothing while accept emptied the block. A finished operation (`complete: true`) with empty text now strikes its target; one that is still arriving with no text still withdraws.

Breaking: no
