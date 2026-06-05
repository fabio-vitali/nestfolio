import {
  STALE_CYCLE_MS,
  deriveAdvisoryCycleState,
} from '../../../src/shared/advisory/advisory-cycle-state';

const NOW = Date.parse('2026-06-05T12:00:00.000Z');
// Anchors relative to NOW, given STALE_CYCLE_MS === 6 min.
const FRESH = '2026-06-05T11:59:00.000Z'; // 1 min old  -> within ceiling
const AT_CEILING = '2026-06-05T11:54:00.000Z'; // exactly 6 min old -> stale
const STALE = '2026-06-05T11:50:00.000Z'; // 10 min old -> stale

function input(over: Partial<Parameters<typeof deriveAdvisoryCycleState>[0]>) {
  return {
    generatingCount: 0,
    failedCount: 0,
    oldestGeneratingAt: null,
    pendingDecisionsCount: 0,
    now: NOW,
    ...over,
  };
}

describe('STALE_CYCLE_MS', () => {
  it('is the 6-minute ceiling shared by both surfaces', () => {
    expect(STALE_CYCLE_MS).toBe(6 * 60 * 1000);
  });
});

describe('deriveAdvisoryCycleState — generating', () => {
  it('is true when the oldest GENERATING row is within the ceiling', () => {
    expect(
      deriveAdvisoryCycleState(input({ generatingCount: 1, oldestGeneratingAt: FRESH })).generating,
    ).toBe(true);
  });

  it('is false when the oldest GENERATING row is older than the ceiling', () => {
    expect(
      deriveAdvisoryCycleState(input({ generatingCount: 1, oldestGeneratingAt: STALE })).generating,
    ).toBe(false);
  });

  it('treats exactly-at-the-ceiling as stale (not generating)', () => {
    expect(
      deriveAdvisoryCycleState(input({ generatingCount: 1, oldestGeneratingAt: AT_CEILING })).generating,
    ).toBe(false);
  });

  it('is false when there are no GENERATING rows', () => {
    expect(
      deriveAdvisoryCycleState(input({ generatingCount: 0, oldestGeneratingAt: FRESH })).generating,
    ).toBe(false);
  });

  it('is false when generatingCount > 0 but oldestGeneratingAt is absent (defensive)', () => {
    expect(
      deriveAdvisoryCycleState(input({ generatingCount: 1, oldestGeneratingAt: null })).generating,
    ).toBe(false);
  });
});

describe('deriveAdvisoryCycleState — failed', () => {
  it('is true for a FAILED row with nothing pending or generating', () => {
    expect(deriveAdvisoryCycleState(input({ failedCount: 1 })).failed).toBe(true);
  });

  it('is true for a stale GENERATING row with nothing pending (uncatchable failure)', () => {
    expect(
      deriveAdvisoryCycleState(input({ generatingCount: 1, oldestGeneratingAt: STALE })).failed,
    ).toBe(true);
  });

  it('is suppressed while a decision is pending', () => {
    expect(
      deriveAdvisoryCycleState(input({ pendingDecisionsCount: 2, failedCount: 1 })).failed,
    ).toBe(false);
  });

  it('is suppressed while a fresh cycle is generating', () => {
    expect(
      deriveAdvisoryCycleState(input({ generatingCount: 1, oldestGeneratingAt: FRESH, failedCount: 1 })).failed,
    ).toBe(false);
  });

  it('is false when idle (nothing pending, generating, or failed)', () => {
    expect(deriveAdvisoryCycleState(input({})).failed).toBe(false);
  });
});
