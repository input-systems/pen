import type { PropSchema } from "@input/pen-types";
import { resolveSchema } from "@input/pen-core";

/** Resolves an inline schema's prop builders into a prop schema record. */
export function resolveProps(
  props: Record<string, unknown>,
): Record<string, PropSchema> {
  const resolved: Record<string, PropSchema> = {};
  for (const [k, v] of Object.entries(props)) {
    resolved[k] = resolveSchema(v);
  }
  return resolved;
}
