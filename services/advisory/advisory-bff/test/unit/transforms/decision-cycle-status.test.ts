import { projectVersioned } from '@nestfolio/event-processor';
import { decisionCycleStatus } from '../../../src/transforms/decision-cycle-status';

const TS = '2026-01-01T00:00:00.000Z';
const makeUow = (type: string, subject: Record<string, unknown>, timestamp = TS) => ({
  event: { id: 'e1', type, timestamp, subject, context: { tenantId: 't1' } },
  payload: {}, record: {},
});

describe('decisionCycleStatus transform', () => {
  it('projects GENERATING (v0) from DECISION_CYCLE_STARTED', () => {
    expect(
      decisionCycleStatus(
        makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd1', tenantId: 't1', status: 'GENERATING', __version: 0 }) as any,
      ),
    ).toEqual(
      projectVersioned('DecisionReadModel', {
        decisionId: 'd1', tenantId: 't1', status: 'GENERATING', version: 0, createdAt: TS, updatedAt: TS,
      }, { version: 0, overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' } }),
    );
  });

  it('projects FAILED (v1) from DECISION_CYCLE_FAILED', () => {
    expect(
      decisionCycleStatus(
        makeUow('DECISION_CYCLE_FAILED', { decisionId: 'd1', tenantId: 't1', status: 'FAILED', __version: 1 }) as any,
      ),
    ).toEqual(
      projectVersioned('DecisionReadModel', {
        decisionId: 'd1', tenantId: 't1', status: 'FAILED', version: 1, createdAt: TS, updatedAt: TS,
      }, { version: 1, overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' } }),
    );
  });

  it('carries the subject __version into the intent version (the DDB ordering guard input)', () => {
    const intent = decisionCycleStatus(
      makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd9', tenantId: 't9', status: 'GENERATING', __version: 0 }) as any,
    ) as { _tag: string; typename: string; version: number };
    expect(intent._tag).toBe('projectVersioned');
    expect(intent.typename).toBe('DecisionReadModel');
    expect(intent.version).toBe(0);
  });

  it('uses the envelope timestamp (not a subject field) for createdAt', () => {
    const intent = decisionCycleStatus(
      makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd2', tenantId: 't2', status: 'GENERATING', __version: 0 }, '2030-09-09T09:09:09.000Z') as any,
    ) as { fields: Record<string, unknown> };
    expect(intent.fields['createdAt']).toBe('2030-09-09T09:09:09.000Z');
  });
});
