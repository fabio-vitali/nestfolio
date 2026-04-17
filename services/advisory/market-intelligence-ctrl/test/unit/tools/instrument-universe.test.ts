import { getInstrumentUniverse } from '../../../src/agents/tools/instrument-universe';

describe('instrument-universe tool', () => {
  it('returns the full approved list by default', () => {
    const result = getInstrumentUniverse();
    expect(result.instruments.length).toBeGreaterThan(0);
    expect(result.count).toBe(result.instruments.length);
    expect(result.instruments[0]).toHaveProperty('ticker');
    expect(result.instruments[0]).toHaveProperty('name');
    expect(result.instruments[0]).toHaveProperty('assetClass');
    expect(result.instruments[0]).toHaveProperty('region');
    expect(result.timestamp).toBeDefined();
  });

  it('filters by asset class', () => {
    const result = getInstrumentUniverse({ assetClass: 'fixed-income' });
    expect(result.instruments.length).toBeGreaterThan(0);
    result.instruments.forEach((i) => expect(i.assetClass).toBe('fixed-income'));
  });

  it('returns an empty list for unknown asset class', () => {
    const result = getInstrumentUniverse({ assetClass: 'crypto' });
    expect(result.instruments).toHaveLength(0);
    expect(result.count).toBe(0);
  });
});
