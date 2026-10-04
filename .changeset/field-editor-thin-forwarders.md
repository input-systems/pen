---
"@input/pen-dom": minor
---

`FieldEditorImpl` and `FieldEditorSession` drop eleven methods that only forwarded to pen-dom's selection reader, projector, focus controller or pending marks: `beginPointerSelection`, `endPointerSelection`, `notifyGestureEvent`, `isAdmissibleGestureRead`, `getGestureWindows`, `hasSelectionInRoot`, `readFieldSelectionOffsets`, `requestDivergenceProjection`, `shouldProjectSelectionAfterReconcile`, `requestActivation` and `resolveInsertMarks`. pen-dom's backends, gestures and host helpers now call those parts directly, and the parts are left out of the published types. Behaviour is unchanged. The host-facing methods (`activateTextSelection`, `commitProgrammaticTextSelection`, `focusSelection`, `requestDomFocus`, `requestRootFocus`, `getSubstituteState`, `projectAfterRebuild`, `setMountRequester`, `scrollIntoView`, `waitForAttachment` and the pending-mark methods) stay.

Breaking: yes — hosts drop calls to the removed methods; pen-dom reports gestures itself, and focus, pending marks and post-rebuild projection keep their existing session methods
