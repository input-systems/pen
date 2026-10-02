---
"@input/pen-dom": patch
---

Selection projection now reads the DOM selection back after every authority-driven write (W3.R1). When the result is not equivalent to the selection authority, or focus is not on the projection target, the field editor emits a `selection-projection-mismatch` diagnostic carrying the record version, the trigger, the expected and actual selections and the surface, once per version and trigger, and does not write again.

Breaking: no
