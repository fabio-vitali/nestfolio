import { routeToPhase } from '../../../src/agent/router';
import { PHASE_ORDER, nextPhase, phaseIndexOf } from '../../../src/agent/state';

describe('Graph structure', () => {
  it('router routes to all 7 phase nodes', () => {
    for (const phase of PHASE_ORDER) {
      expect(routeToPhase({ phase })).toBe(`${phase}_node`);
    }
  });

  it('router routes completed to __end__', () => {
    expect(routeToPhase({ phase: 'completed' })).toBe('__end__');
  });

  it('nextPhase chains correctly through all phases', () => {
    let current = PHASE_ORDER[0];
    for (let i = 1; i < PHASE_ORDER.length; i++) {
      const next = nextPhase(current);
      expect(next).toBe(PHASE_ORDER[i]);
      current = next as any;
    }
    expect(nextPhase(current)).toBe('completed');
  });

  it('phaseIndexOf is consistent with PHASE_ORDER', () => {
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      expect(phaseIndexOf(PHASE_ORDER[i])).toBe(i);
    }
  });
});
