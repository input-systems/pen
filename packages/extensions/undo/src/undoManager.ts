import type {
  CRDTUndoCaptureKey,
  CRDTUndoManager,
  UndoManager,
  OpOrigin,
  Unsubscribe,
} from "@input/pen-types";
import { getOpOriginType } from "./origin";

export interface UndoManagerImplOptions {
  onListenerError?: (error: unknown) => void;
}

export class UndoManagerImpl implements UndoManager {
  private readonly _crdtUndo: CRDTUndoManager;
  private readonly _trackedOriginTypes = new Map<string, number>();
  private readonly _listeners = new Set<() => void>();
  private readonly _onListenerError?: (error: unknown) => void;
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _groupTimeout = 1000;
  private _lastCaptureExplicit = false;
  private _destroyed = false;
  _onCaptureBoundary: (() => void) | null = null;
  _isHistoryOperation = false;

  constructor(
    crdtUndo: CRDTUndoManager,
    trackedOrigins?: Iterable<OpOrigin>,
    options?: UndoManagerImplOptions,
  ) {
    this._crdtUndo = crdtUndo;
    this._onListenerError = options?.onListenerError;
    for (const origin of trackedOrigins ?? []) {
      this._trackedOriginTypes.set(getOpOriginType(origin), 1);
    }
  }

  undo(): boolean {
    if (this._destroyed) {
      return false;
    }
    this._lastCaptureExplicit = false;
    this._clearIdleTimer();
    this._stopCapturingWithBoundary();
    this._isHistoryOperation = true;
    try {
      return this._crdtUndo.undo();
    } finally {
      this._isHistoryOperation = false;
    }
  }

  redo(): boolean {
    if (this._destroyed) {
      return false;
    }
    this._lastCaptureExplicit = false;
    this._clearIdleTimer();
    this._stopCapturingWithBoundary();
    this._isHistoryOperation = true;
    try {
      return this._crdtUndo.redo();
    } finally {
      this._isHistoryOperation = false;
    }
  }

  canUndo(): boolean {
    return !this._destroyed && this._crdtUndo.canUndo();
  }

  canRedo(): boolean {
    return !this._destroyed && this._crdtUndo.canRedo();
  }

  stopCapturing(): void {
    if (this._destroyed) {
      return;
    }
    this._stopCapturingWithBoundary();
    this._clearIdleTimer();
    this._notifyListeners();
  }

  withCapture<T>(origin: OpOrigin, groupId: string | null, run: () => T): T {
    if (this._destroyed || !this._crdtUndo.setCaptureKey) {
      return run();
    }
    const key: CRDTUndoCaptureKey =
      groupId === null
        ? { key: `origin:${getOpOriginType(origin)}`, explicit: false }
        : { key: `group:${groupId}`, explicit: true };
    const previous = this._crdtUndo.setCaptureKey(key);
    try {
      return run();
    } finally {
      this._crdtUndo.setCaptureKey(previous);
      if (this.hasTrackedOrigin(origin)) {
        this._lastCaptureExplicit = key.explicit;
      }
    }
  }

  setGroupTimeout(ms: number): void {
    if (this._destroyed) {
      return;
    }
    this._groupTimeout = ms;
    this._crdtUndo.setCaptureTimeout?.(ms);
  }

  registerTrackedOrigins(origins: OpOrigin[]): Unsubscribe {
    if (this._destroyed) {
      return () => {};
    }
    const registeredOrigins = new Set<OpOrigin>();
    let didDispose = false;
    for (const origin of origins) {
      if (registeredOrigins.has(origin)) {
        continue;
      }
      registeredOrigins.add(origin);
      this._incrementTrackedOrigin(origin);
    }
    return () => {
      if (didDispose) {
        return;
      }
      didDispose = true;
      for (const origin of registeredOrigins) {
        this._decrementTrackedOrigin(origin);
      }
    };
  }

  hasTrackedOrigin(origin: OpOrigin): boolean {
    return (this._trackedOriginTypes.get(getOpOriginType(origin)) ?? 0) > 0;
  }

  onStackChange(callback: () => void): Unsubscribe {
    if (this._destroyed) {
      return () => {};
    }
    this._listeners.add(callback);
    return () => {
      this._listeners.delete(callback);
    };
  }

  resetIdleTimer(): void {
    if (this._destroyed || this._lastCaptureExplicit) {
      return;
    }
    this._clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      this._stopCapturingWithBoundary();
      this._notifyListeners();
    }, this._groupTimeout);
  }

  _notifyListeners(): void {
    for (const cb of this._listeners) {
      try {
        cb();
      } catch (error) {
        this._onListenerError?.(error);
      }
    }
  }

  destroy(): void {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._clearIdleTimer();
    this._listeners.clear();
    this._crdtUndo.destroy();
  }

  private _incrementTrackedOrigin(origin: OpOrigin): void {
    const originType = getOpOriginType(origin);
    const count = this._trackedOriginTypes.get(originType) ?? 0;
    if (count === 0) {
      this._crdtUndo.addTrackedOrigin(originType);
    }
    this._trackedOriginTypes.set(originType, count + 1);
  }

  private _decrementTrackedOrigin(origin: OpOrigin): void {
    const originType = getOpOriginType(origin);
    const count = this._trackedOriginTypes.get(originType) ?? 0;
    if (count <= 1) {
      this._trackedOriginTypes.delete(originType);
      this._crdtUndo.removeTrackedOrigin(originType);
      return;
    }
    this._trackedOriginTypes.set(originType, count - 1);
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  private _stopCapturingWithBoundary(): void {
    this._onCaptureBoundary?.();
    this._crdtUndo.stopCapturing();
  }
}
