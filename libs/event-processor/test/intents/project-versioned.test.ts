import { projectVersioned } from '../../src/intents/project-versioned';

describe('projectVersioned()', () => {
  it('creates a ProjectVersionedIntent (inline fields + static version)', () => {
    const intent = projectVersioned('PortfolioSummary', { totalValueCents: 100 }, { version: 7 });
    expect(intent).toEqual({
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: { totalValueCents: 100 },
      version: 7,
    });
  });

  it('passes overrides through', () => {
    const intent = projectVersioned('PortfolioSummary', { a: 1 }, {
      version: 2,
      overrides: { pk: 'P#1', sk: 'S#1' },
    });
    expect(intent).toMatchObject({ overrides: { pk: 'P#1', sk: 'S#1' }, version: 2 });
  });

  it('mapper mode returns a HandlerFn that derives fields + version from payload', () => {
    const fn = projectVersioned(
      'PortfolioSummary',
      (payload) => ({ totalValueCents: (payload as { v: number }).v }),
      { version: (payload) => (payload as { seq: number }).seq },
    );
    const intent = (fn as (p: unknown, c: unknown) => unknown)({ v: 50, seq: 9 }, {});
    expect(intent).toEqual({
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: { totalValueCents: 50 },
      version: 9,
    });
  });
});
