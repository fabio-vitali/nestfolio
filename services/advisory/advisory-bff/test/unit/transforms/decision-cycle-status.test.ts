import { projectVersioned } from '@nestfolio/event-processor';
import { decisionCycleStatus } from '../../../src/transforms/decision-cycle-status';

const TS = '2026-01-01T00:00:00.000Z';
// Identity (tenantId) is DRY — it travels in the event CONTEXT, never the subject.
const makeUow = (
  type: string,
  subject: Record<string, unknown>,
  { tenantId = 't1', timestamp = TS }: { tenantId?: string; timestamp?: string } = {},
) => ({
  event: { id: 'e1', type, timestamp, subject, context: { tenantId } },
  payload: {}, record: {},
});

describe('decisionCycleStatus transform', () => {
  it('projects GENERATING (v0) from DECISION_CYCLE_STARTED', () => {
    expect(
      decisionCycleStatus(
        makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd1', status: 'GENERATING', __version: 0 }, { tenantId: 't1' }) as any,
      ),
    ).toEqual(
      projectVersioned('DecisionReadModel', {
        decisionId: 'd1', tenantId: 't1', status: 'GENERATING', trigger: '', version: 0, createdAt: TS, updatedAt: TS,
      }, { version: 0, overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' } }),
    );
  });

  it('projects FAILED (v1) from DECISION_CYCLE_FAILED', () => {
    expect(
      decisionCycleStatus(
        makeUow('DECISION_CYCLE_FAILED', { decisionId: 'd1', status: 'FAILED', __version: 1 }, { tenantId: 't1' }) as any,
      ),
    ).toEqual(
      projectVersioned('DecisionReadModel', {
        decisionId: 'd1', tenantId: 't1', status: 'FAILED', trigger: '', version: 1, createdAt: TS, updatedAt: TS,
      }, { version: 1, overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' } }),
    );
  });

  // Regression (2026-06-16): identity is DRY — the row key MUST come from context.tenantId,
  // never from a (now-absent) subject.tenantId, or the row lands at Decision#undefined#<id>.
  it('derives the row key from context.tenantId, never Decision#undefined (subject is DRY)', () => {
    const intent = decisionCycleStatus(
      makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd1', status: 'GENERATING', __version: 0 }, { tenantId: 'tenant-xyz' }) as any,
    ) as { overrides: { pk: string }; fields: Record<string, unknown> };
    expect(intent.overrides.pk).toBe('Decision#tenant-xyz#d1');
    expect(intent.overrides.pk).not.toContain('undefined');
    expect(intent.fields['tenantId']).toBe('tenant-xyz');
  });

  // Regression: the cycle-status row MUST carry a (non-undefined) trigger.
  // getPendingDecisions resolves DecisionPacket.trigger as String! (non-nullable);
  // a row without trigger makes the whole list query fail with "Cannot return null
  // for non-nullable type: 'String' .../trigger" and the /advisory page errors out
  // instead of showing the generating/failed state (caught by the WS-3 Playwright e2e).
  it('writes a non-null trigger so the row is valid for getPendingDecisions (String!)', () => {
    const intent = decisionCycleStatus(
      makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd3', status: 'GENERATING', __version: 0 }, { tenantId: 't3' }) as any,
    ) as { fields: Record<string, unknown> };
    expect(intent.fields).toHaveProperty('trigger');
    expect(typeof intent.fields['trigger']).toBe('string');
  });

  it('carries the subject __version into the intent version (the DDB ordering guard input)', () => {
    const intent = decisionCycleStatus(
      makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd9', status: 'GENERATING', __version: 0 }, { tenantId: 't9' }) as any,
    ) as { _tag: string; typename: string; version: number };
    expect(intent._tag).toBe('projectVersioned');
    expect(intent.typename).toBe('DecisionReadModel');
    expect(intent.version).toBe(0);
  });

  it('uses the envelope timestamp (not a subject field) for createdAt', () => {
    const intent = decisionCycleStatus(
      makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd2', status: 'GENERATING', __version: 0 }, { tenantId: 't2', timestamp: '2030-09-09T09:09:09.000Z' }) as any,
    ) as { fields: Record<string, unknown> };
    expect(intent.fields['createdAt']).toBe('2030-09-09T09:09:09.000Z');
  });
});
