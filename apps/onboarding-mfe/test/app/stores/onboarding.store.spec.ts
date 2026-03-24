import { TestBed } from '@angular/core/testing';
import { OnboardingStore } from '../../../src/app/stores/onboarding.store';

describe('OnboardingStore', () => {
  let store: InstanceType<typeof OnboardingStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [OnboardingStore] });
    store = TestBed.inject(OnboardingStore);
  });

  it('has initial state', () => {
    expect(store.phaseIndex()).toBe(0);
    expect(store.totalPhases()).toBe(7);
    expect(store.phase()).toBe('goal');
    expect(store.isComplete()).toBe(false);
  });

  it('computes progress', () => {
    expect(store.progress()).toBeCloseTo(14.29, 1);
  });

  it('updates from agent state', () => {
    store.updateFromAgent({ phaseIndex: 3, phase: 'capital' });
    expect(store.phaseIndex()).toBe(3);
    expect(store.phase()).toBe('capital');
  });

  it('marks complete', () => {
    store.markComplete();
    expect(store.isComplete()).toBe(true);
  });

  it('resets to initial state', () => {
    store.updateFromAgent({ phaseIndex: 5, phase: 'operating_mode' });
    store.reset();
    expect(store.phaseIndex()).toBe(0);
    expect(store.phase()).toBe('goal');
  });
});
