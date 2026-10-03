---
"@input/pen-dom": patch
---

Carets beside inline atoms are drawn correctly. Atoms no longer sit on their own line: the caret-boundary `<br>` inside each atom host is hidden, so a mention between words shares the text line. A caret beside a chip takes its top and height from the text line, not the chip's padded box, and a chip's padding no longer grows the measured line box. The EditContext backend no longer treats a block holding only atoms as empty, so a caret after such an atom stays there and typing lands after it. The vanilla `mountEditor` tree renders inline atoms in blocks that are not being edited. The contenteditable backend compares and steps over the field's logical text (each inline atom one U+FFFC) instead of `Y.Text#toString()`, which drops atoms: a composition beside an atom no longer commits a stray U+FFFC character into the document, and grapheme deletes after an atom land on the right offset.

Breaking: no
