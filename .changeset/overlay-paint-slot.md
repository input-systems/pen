---
"@input/pen-dom": patch
---

The DOM scheduler paints overlays: `getRootOverlay(root)` exposes the per-root paint plan and contributor API (`registerContributor`, `onPaintPlan`, `requestPaint`), and each editor root now holds one `data-pen-overlay-layer` element, appended as the root's last child when a field editor attaches the root. No contributor is registered by default, so the layer paints nothing yet. `DomScheduler` gains `setOverlayPainter`, `requestPaint`, and `flushCount` and `paintCount` diagnostics; `GeometryReaderHost` gains `onGenerationBump`; `FieldEditorImpl.setReadOnly(readonly)` carries the renderer `readonly` prop, and `mountEditor` sets it. Host CSS that targets the root's `:last-child` now matches the layer.

Breaking: no
