import { routeToPhase } from '../../../src/agent/router';
import { PHASE_ORDER } from '../../../src/agent/state';

describe('routeToPhase', () => {
  it('routes to goal when phase is goal', () => {
    expect(routeToPhase({ phase: 'goal' })).toBe('goal_node');
  });

  it('routes to operating_mode when phase is operating_mode', () => {
    expect(routeToPhase({ phase: 'operating_mode' })).toBe('operating_mode_node');
  });

  it('routes to each phase node correctly', () => {
    for (const phase of PHASE_ORDER) {
      expect(routeToPhase({ phase })).toBe(`${phase}_node`);
    }
  });

  it('routes to __end__ when phase is completed', () => {
    expect(routeToPhase({ phase: 'completed' })).toBe('__end__');
  });

  it('routes to safety_cap_node when turnCount >= 50', () => {
    expect(routeToPhase({ phase: 'capital', turnCount: 50 })).toBe('safety_cap_node');
    expect(routeToPhase({ phase: 'horizon', turnCount: 55 })).toBe('safety_cap_node');
  });

  it('routes normally when turnCount < 50', () => {
    expect(routeToPhase({ phase: 'capital', turnCount: 49 })).toBe('capital_node');
  });
});
