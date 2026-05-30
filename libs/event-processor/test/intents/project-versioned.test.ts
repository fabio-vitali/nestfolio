import { projectVersioned } from '../../src/intents/project-versioned';
import type { Projection } from '../../src/types/ownership';

// Register a probe P3 typename so RejectNonP1<'AdvisoryStatusProbe'> resolves to the literal.
declare module '../../src' {
  interface ReadModelOwnership { AdvisoryStatusProbe: Projection<'P3'> }
}

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

  it('mapper mode with a static version number', () => {
    const fn = projectVersioned(
      'PortfolioSummary',
      (payload) => ({ totalValueCents: (payload as { v: number }).v }),
      { version: 4 },
    );
    const intent = (fn as (p: unknown, c: unknown) => unknown)({ v: 30 }, {});
    expect(intent).toEqual({
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: { totalValueCents: 30 },
      version: 4,
    });
  });
});

describe('projectVersioned accepts P3 (derived aggregate) typenames', () => {
  it('compiles + returns an intent for a P3-tagged typename', () => {
    const intent = projectVersioned('AdvisoryStatusProbe', { inFlightCount: 3 }, {
      version: 5, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
    });
    expect(intent).toEqual({
      _tag: 'projectVersioned',
      typename: 'AdvisoryStatusProbe',
      fields: { inFlightCount: 3 },
      version: 5,
      overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
    });
  });
});
