import { TestBed } from '@angular/core/testing';
import { FeatureFlagsStore } from './feature-flags.store';
import type { FeatureFlag } from './feature-flags.model';

describe('FeatureFlagsStore', () => {
  let store: InstanceType<typeof FeatureFlagsStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(FeatureFlagsStore);
  });

  it('should start with empty flags', () => {
    expect(store.flags()).toEqual({});
    expect(store.disabledFlags()).toEqual([]);
  });

  describe('setFlags', () => {
    it('should populate flags from array', () => {
      const flags: FeatureFlag[] = [
        { name: 'initiateDeposit', enabled: true },
        { name: 'requestWithdrawal', enabled: true },
      ];

      store.setFlags(flags);

      expect(Object.keys(store.flags())).toHaveLength(2);
      expect(store.flags()['initiateDeposit']).toEqual({ name: 'initiateDeposit', enabled: true });
      expect(store.flags()['requestWithdrawal']).toEqual({ name: 'requestWithdrawal', enabled: true });
    });

    it('should replace existing flags', () => {
      store.setFlags([{ name: 'oldFlag', enabled: true }]);
      store.setFlags([{ name: 'newFlag', enabled: false, reason: 'test' }]);

      expect(store.flags()['oldFlag']).toBeUndefined();
      expect(store.flags()['newFlag']).toEqual({ name: 'newFlag', enabled: false, reason: 'test' });
    });
  });

  describe('updateFlag', () => {
    it('should update a single flag', () => {
      store.setFlags([
        { name: 'initiateDeposit', enabled: true },
        { name: 'requestWithdrawal', enabled: true },
      ]);

      store.updateFlag({ name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue' });

      expect(store.flags()['initiateDeposit']).toEqual({
        name: 'initiateDeposit',
        enabled: false,
        reason: 'Broker connectivity issue',
      });
      expect(store.flags()['requestWithdrawal']).toEqual({ name: 'requestWithdrawal', enabled: true });
    });

    it('should add a flag that did not exist', () => {
      store.updateFlag({ name: 'confirmDecision', enabled: false });

      expect(store.flags()['confirmDecision']).toEqual({ name: 'confirmDecision', enabled: false });
    });
  });

  describe('isEnabled', () => {
    it('should return true for enabled flag', () => {
      store.setFlags([{ name: 'initiateDeposit', enabled: true }]);
      expect(store.isEnabled('initiateDeposit')).toBe(true);
    });

    it('should return false for disabled flag', () => {
      store.setFlags([{ name: 'initiateDeposit', enabled: false }]);
      expect(store.isEnabled('initiateDeposit')).toBe(false);
    });

    it('should return true for unknown flag (default)', () => {
      expect(store.isEnabled('nonExistentFlag')).toBe(true);
    });
  });

  describe('disabledFlags', () => {
    it('should return only disabled flags', () => {
      store.setFlags([
        { name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue' },
        { name: 'requestWithdrawal', enabled: false, reason: 'Broker connectivity issue' },
        { name: 'confirmDecision', enabled: true },
      ]);

      const disabled = store.disabledFlags();
      expect(disabled).toHaveLength(2);
      expect(disabled.map(f => f.name).sort()).toEqual(['initiateDeposit', 'requestWithdrawal']);
    });

    it('should return empty array when all flags are enabled', () => {
      store.setFlags([
        { name: 'initiateDeposit', enabled: true },
        { name: 'requestWithdrawal', enabled: true },
      ]);

      expect(store.disabledFlags()).toEqual([]);
    });
  });
});
