/**
 * Shared derivation of the advisory decision-cycle UI state, consumed by both
 * the `/advisory` decision list (advisory-mfe) and the `/dashboard` cycle banner
 * (dashboard-mfe). Single source of truth for the staleness ceiling so the two
 * surfaces cannot silently diverge.
 *
 * Inputs are pre-aggregated so the helper stays framework-free and identical for
 * both call sites: advisory-mfe folds its per-row decision list down to these
 * counts (`oldestGeneratingAt` = the earliest GENERATING row's createdAt);
 * dashboard-mfe reads them straight off the AdvisoryStatus aggregate row.
 */

/**
 * A GENERATING signal older than this (with no STARTED→PENDING/FAILED
 * transition) renders as failed. Derived from AGENT_BUDGETS (PORTFOLIO_ENGINE
 * 120s + ADVISORY_NARRATIVE 120s = 240s sequential) + ~2 min margin for
 * ParallelProjections + AssemblePacket + EB→SQS→CDC propagation + clock skew.
 * Covers uncatchable States.Runtime failures that emit no DECISION_CYCLE_FAILED.
 */
export const STALE_CYCLE_MS = 6 * 60 * 1000;

export interface AdvisoryCycleStateInput {
  /** Number of in-flight (GENERATING) decision cycles. */
  generatingCount: number;
  /** Number of cycles that emitted DECISION_CYCLE_FAILED. */
  failedCount: number;
  /** createdAt of the oldest GENERATING cycle, or null when none are generating. */
  oldestGeneratingAt: string | null;
  /** Number of real (non-lifecycle) pending decisions on screen / in the aggregate. */
  pendingDecisionsCount: number;
  /** Wall-clock reference (ms epoch) the staleness check is evaluated against. */
  now: number;
}

export interface AdvisoryCycleState {
  /** A cycle is actively generating: at least one GENERATING row within the ceiling. */
  generating: boolean;
  /**
   * The latest signal is a failure with nothing in flight or ready: a FAILED
   * cycle, or a GENERATING cycle that blew the staleness ceiling (uncatchable
   * failure). Suppressed while anything is pending or freshly generating.
   */
  failed: boolean;
}

/**
 * Pure derivation of `{ generating, failed }` from pre-aggregated cycle counts.
 *
 * `generating` is gated on the OLDEST generating cycle being within the ceiling:
 * if the longest-running in-flight cycle has exceeded STALE_CYCLE_MS, the surface
 * stops showing the spinner and (absent anything pending) flips to failed.
 */
export function deriveAdvisoryCycleState(
  input: AdvisoryCycleStateInput,
): AdvisoryCycleState {
  const { generatingCount, failedCount, oldestGeneratingAt, pendingDecisionsCount, now } = input;

  const generating =
    generatingCount > 0 &&
    oldestGeneratingAt !== null &&
    now - Date.parse(oldestGeneratingAt) < STALE_CYCLE_MS;

  const failed =
    pendingDecisionsCount === 0 &&
    !generating &&
    (failedCount > 0 || generatingCount > 0);

  return { generating, failed };
}
