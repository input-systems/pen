---
"@input/pen-core": patch
"@input/pen-dom": patch
---

Map a container's selection around the block when nested children supply the only inline content, and walk visible nested blocks for document-edge caret so Cmd+Down in an opened quote lands in the last nested paragraph instead of selecting the container. A decoration change on an expanded multi-block surface no longer collapses the cross-block selection into each rebuilt block: element-local selection preservation declines when an endpoint lies outside the element, and the selection is projected back from the editor after the rebuild.
