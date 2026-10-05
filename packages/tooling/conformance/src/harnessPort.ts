/**
 * The port the conformance harness is served on. PEN_HARNESS_PORT lets
 * parallel checkouts (git worktrees) run the suite side by side;
 * `reuseExistingServer` would otherwise test another checkout's harness on
 * the shared port. Scenarios that need their own origin (HOST4 insecure)
 * read it from here rather than hard-coding the default.
 */
export const HARNESS_PORT = Number(process.env.PEN_HARNESS_PORT ?? 4174);
