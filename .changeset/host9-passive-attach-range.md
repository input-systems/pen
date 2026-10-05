---
"@input/pen-dom": patch
---

A passive backend attach (HOST9) no longer writes the native range. When a programmatic selection switched the field's surface while a host control held focus, the contenteditable and EditContext backends wrote the record's range into the unfocused field, which moved focus out of the host control and lost its selection; the expanded backend already withheld the write. The EditContext backend still fills its buffer, and the next projection that finds focus in the editor writes the range. The vanilla host (`mountEditor`) now marks its blocks host as the field surface while the selection is expanded, as React and Vue already did; unmarked, HOST9 read focus on it as a foreign text control's, so returning to a single block attached passively. A surface switch also reads where focus is before the old surface detaches, since detaching drops that focus to the body.

Breaking: no
