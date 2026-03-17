// libs/agent-core/test/tier-escalation.test.ts
import { buildEscalationPath } from '../src/tier-escalation';

describe('buildEscalationPath', () => {
  it('returns haiku → sonnet → opus for haiku start', () => {
    expect(buildEscalationPath('haiku')).toEqual(['haiku', 'sonnet', 'opus']);
  });

  it('returns sonnet → opus for sonnet start', () => {
    expect(buildEscalationPath('sonnet')).toEqual(['sonnet', 'opus']);
  });

  it('returns opus only for opus start', () => {
    expect(buildEscalationPath('opus')).toEqual(['opus']);
  });
});
