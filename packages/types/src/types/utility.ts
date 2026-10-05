export type Unsubscribe = () => void;

export type Spacing =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

export type BorderDef = {
  width?: number;
  style?: string;
  color?: string;
};

/**
 * Tells a thenable from a synchronous value.
 *
 * @param value - Any value, typically the result of a callback that may be async.
 * @returns `true` when `value` is an object or function with a callable `then`.
 * @throws Never.
 */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
