import { routeToPhase } from '../../../src/agent/router';

describe('routeToPhase', () => {
  it('routes to goal when phase is goal', () => {
    expect(routeToPhase({ phase: 'goal' })).toBe('goal_node');
  });

  it('routes to horizon when phase is horizon', () => {
    expect(routeToPhase({ phase: 'horizon' })).toBe('horizon_node');
  });

  it('routes to each phase node correctly', () => {
    const phases = ['goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate'];
    for (const phase of phases) {
      expect(routeToPhase({ phase })).toBe(`${phase}_node`);
    }
  });

  it('routes to __end__ when phase is completed', () => {
    expect(routeToPhase({ phase: 'completed' })).toBe('__end__');
  });

  it('routes to safety_cap_node when turnCount >= 50', () => {
    expect(routeToPhase({ phase: 'capital', turnCount: 50 })).toBe('safety_cap_node');
    expect(routeToPhase({ phase: 'risk', turnCount: 55 })).toBe('safety_cap_node');
  });

  it('routes normally when turnCount < 50', () => {
    expect(routeToPhase({ phase: 'capital', turnCount: 49 })).toBe('capital_node');
  });
});
