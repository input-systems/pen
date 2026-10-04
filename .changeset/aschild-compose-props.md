---
"@input/pen-react": patch
---

`asChild` composes props instead of letting the child's replace Pen's. Event handlers on the child (or passed to the primitive) run first and then the primitive's own, unless the outer handler called `preventDefault()`; class names join; styles merge per property with the outer value winning. `<Pen.Toolbar.Button asChild><button onClick onMouseDown /></Pen.Toolbar.Button>` keeps `onAction` and the AX3 press guard that keeps focus in the field.

Breaking: no
