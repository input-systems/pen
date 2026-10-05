import { describe, expect, it, vi } from "vitest";

import { DEFAULT_UNDO_MAX_DEPTH } from "../undoExtension";
import { UndoManagerImpl } from "../undoManager";

function createCrdtUndo() {
  return {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    canUndo: vi.fn(() => true),
    canRedo: vi.fn(() => false),
    stopCapturing: vi.fn(),
    setCaptureTimeout: vi.fn(),
    setCaptureKey: vi.fn((_key: unknown) => null),
    addTrackedOrigin: vi.fn(),
    removeTrackedOrigin: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("@input/pen-undo UndoManagerImpl", () => {
  it("delegates undo/redo operations to the CRDT undo manager", () => {
    const crdtUndo = createCrdtUndo();

    const manager = new UndoManagerImpl(crdtUndo);

    expect(manager.undo()).toBe(true);
    expect(manager.redo()).toBe(true);
    expect(manager.canUndo()).toBe(true);
    expect(manager.canRedo()).toBe(false);
    manager.stopCapturing();

    expect(crdtUndo.undo).toHaveBeenCalled();
    expect(crdtUndo.redo).toHaveBeenCalled();
    expect(crdtUndo.stopCapturing).toHaveBeenCalled();
  });

  it("registers tracked origins idempotently", () => {
    const crdtUndo = createCrdtUndo();

    const manager = new UndoManagerImpl(crdtUndo);
    const unregister = manager.registerTrackedOrigins(["ai"]);

    expect(manager.hasTrackedOrigin("ai")).toBe(true);
    expect(crdtUndo.addTrackedOrigin).toHaveBeenCalledTimes(1);

    unregister();
    unregister();

    expect(manager.hasTrackedOrigin("ai")).toBe(false);
    expect(crdtUndo.removeTrackedOrigin).toHaveBeenCalledTimes(1);
  });

  it("keeps shared tracked origins registered until all owners release them", () => {
    const crdtUndo = createCrdtUndo();

    const manager = new UndoManagerImpl(crdtUndo);
    const unregisterA = manager.registerTrackedOrigins(["ai"]);
    const unregisterB = manager.registerTrackedOrigins(["ai"]);

    expect(crdtUndo.addTrackedOrigin).toHaveBeenCalledTimes(1);

    unregisterA();
    expect(manager.hasTrackedOrigin("ai")).toBe(true);
    expect(crdtUndo.removeTrackedOrigin).not.toHaveBeenCalled();

    unregisterB();
    expect(manager.hasTrackedOrigin("ai")).toBe(false);
    expect(crdtUndo.removeTrackedOrigin).toHaveBeenCalledTimes(1);
  });

  it("AIB4: withCapture scopes the capture key to the run and never stops capturing", () => {
    const crdtUndo = createCrdtUndo();
    const manager = new UndoManagerImpl(crdtUndo);
    const onCaptureBoundary = vi.fn();
    manager._onCaptureBoundary = onCaptureBoundary;

    const result = manager.withCapture({ type: "ai", groupId: "g1" }, "g1", () => 7);
    manager.withCapture("user", null, () => undefined);

    expect(result).toBe(7);
    expect(crdtUndo.setCaptureKey.mock.calls).toEqual([
      [{ key: "group:g1", explicit: true }],
      [null],
      [{ key: "origin:user", explicit: false }],
      [null],
    ]);
    expect(onCaptureBoundary).not.toHaveBeenCalled();
    expect(crdtUndo.stopCapturing).not.toHaveBeenCalled();
  });

  it("H.6/CH7 default max-depth cap is 500", () => {
    expect(DEFAULT_UNDO_MAX_DEPTH).toBe(500);
  });

  it("CH5: reports a thrown stack listener through onListenerError", () => {
    const crdtUndo = createCrdtUndo();
    const errors: unknown[] = [];
    const manager = new UndoManagerImpl(crdtUndo, undefined, {
      onListenerError(error) {
        errors.push(error);
      },
    });

    manager.onStackChange(() => {
      throw new Error("listener-boom");
    });
    manager.stopCapturing();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe("listener-boom");
  });

  it("CH7 destroy() tears down the CRDT undo manager", () => {
    const crdtUndo = createCrdtUndo();
    const manager = new UndoManagerImpl(crdtUndo);

    manager.destroy();

    expect(crdtUndo.destroy).toHaveBeenCalledTimes(1);
    crdtUndo.undo.mockClear();
    crdtUndo.redo.mockClear();
    crdtUndo.stopCapturing.mockClear();
    crdtUndo.setCaptureTimeout.mockClear();
    crdtUndo.addTrackedOrigin.mockClear();

    expect(manager.undo()).toBe(false);
    expect(manager.redo()).toBe(false);
    manager.stopCapturing();
    expect(manager.withCapture("user", "after-destroy", () => 1)).toBe(1);
    manager.setGroupTimeout(50);
    manager.resetIdleTimer();
    expect(manager.registerTrackedOrigins(["ai"])).toEqual(expect.any(Function));
    manager.onStackChange(() => {
      throw new Error("destroyed managers must not notify");
    });

    expect(crdtUndo.undo).not.toHaveBeenCalled();
    expect(crdtUndo.redo).not.toHaveBeenCalled();
    expect(crdtUndo.stopCapturing).not.toHaveBeenCalled();
    expect(crdtUndo.setCaptureTimeout).not.toHaveBeenCalled();
    expect(crdtUndo.addTrackedOrigin).not.toHaveBeenCalled();
  });
});
