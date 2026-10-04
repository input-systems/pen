---
"@input/pen-dom": minor
---

The contenteditable, EditContext and expanded input backends share one base class for their element, `Y.Text`, observer, attachment and decoration state and their attach and detach (CS5); each keeps only its input technology. Input behaviour is unchanged. The protected surface a subclass sees changed: `ContentEditableBackend` drops `fullReconcileActiveField` and `reconcileFromModelDiscardingMutations` for the inherited `rebuildField(inlineDecorations?, blockId?)`, and `applyTextDiffAsOps` drops its `deferredRemoteDeltas` parameter; `EditContextBackend` drops `resolveEditorSelectionRange`, `resolveCollapsedEditorSelectionRange`, `getAuthoritativeTextInputSelection` and `resolveKeyDownRange`, resolves key and `textupdate` ranges from `authorityRangeIn(blockId)` and `trustedCaretIn(blockId)`, and `trustedCaretIn` now returns the collapsed trusted offset or `null`. `ExpandedContentEditableBackend`'s input handlers become `protected`.

Breaking: yes — hosts that subclass a backend and call or override a removed protected member move to `rebuildField`, `authorityRangeIn` or `trustedCaretIn`, and drop the `deferredRemoteDeltas` argument from `applyTextDiffAsOps`
