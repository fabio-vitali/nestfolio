import { MFE_CATALOG, type MfeCatalogEntry } from '../../src/mfe-catalog';

describe('MFE_CATALOG', () => {
  it('contains exactly 5 entries for the 5 BFFs', () => {
    expect(MFE_CATALOG).toHaveLength(5);
  });

  it('has the expected mfe keys', () => {
    expect(MFE_CATALOG.map(e => e.key).sort()).toEqual([
      'advisory', 'dashboard', 'investor', 'ledger', 'onboarding',
    ]);
  });

  it('has 4 Facade-bearing entries (onboarding is the exception)', () => {
    const facadeBearing = MFE_CATALOG.filter(e => e.hasFacade);
    expect(facadeBearing).toHaveLength(4);
    expect(facadeBearing.map(e => e.key).sort()).toEqual([
      'advisory', 'dashboard', 'investor', 'ledger',
    ]);
    const onboarding = MFE_CATALOG.find(e => e.key === 'onboarding')!;
    expect(onboarding.hasFacade).toBe(false);
  });

  it('every entry resolves to an existing service name', () => {
    const validServices = [
      'investor-bff', 'advisory-bff', 'ledger-bff', 'dashboard-bff', 'onboarding-bff',
    ];
    for (const entry of MFE_CATALOG) {
      expect(validServices).toContain(entry.service);
    }
  });

  it('entries are typed via MfeCatalogEntry', () => {
    const sample: MfeCatalogEntry = MFE_CATALOG[0];
    expect(typeof sample.key).toBe('string');
    expect(typeof sample.subsystem).toBe('string');
    expect(typeof sample.service).toBe('string');
    expect(typeof sample.hasFacade).toBe('boolean');
  });

  it('keys are unique across entries', () => {
    const keys = MFE_CATALOG.map(e => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
