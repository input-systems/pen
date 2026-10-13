---
"@input/pen-core": patch
"@input/pen-dom": patch
"@input/pen-interop": patch
---

Editing and paste fixes (D7, D8, SEC3):

- Typing `**bold**`, `*italic*`, `` `code` `` or another inline shortcut now ends that mark at the caret, so the text typed next is plain. Both the EditContext and contenteditable input paths run the inline rules in pen-dom.
- Deleting the last characters of a link and retyping them puts the new characters back inside the link, up to as many characters as were deleted.
- Enter on an empty last line of a code block leaves the block and opens a paragraph below.
- Pasting HTML copied from a web page no longer turns the page's own background and text colour into highlight and colour marks; colours authored on the copied text itself are kept.

Breaking: no
