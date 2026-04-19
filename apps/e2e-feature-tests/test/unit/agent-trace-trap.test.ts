import { AgentTraceTrap } from '../../src/helpers/agent-trace-trap';

describe('AgentTraceTrap<"advisoryNarrative">', () => {
  it('exposes the static arm factory and instance getLatencyBudget', () => {
    expect(typeof AgentTraceTrap.arm).toBe('function');
    const budget = AgentTraceTrap.prototype.getLatencyBudget.call({ agent: 'advisoryNarrative' });
    expect(typeof budget).toBe('number');
    expect(budget).toBeGreaterThan(0);
  });
});
