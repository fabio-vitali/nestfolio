/** @jest-environment node */
jest.mock('@angular/core', () => ({
  InjectionToken: class { constructor(private desc: string) {} toString() { return `InjectionToken ${this.desc}`; } },
}));

import { MFE_DOMAIN } from '../../src/graphql/mfe-domain.token';
import { GraphqlService } from '../../src/graphql/graphql.service';
import { provideMfeGraphql } from '../../src/graphql/provide-mfe-graphql';

// Mock the GraphqlService import path used by provideMfeGraphql.
jest.mock('../../src/graphql/graphql.service', () => ({
  GraphqlService: class GraphqlServiceStub {},
}));

describe('provideMfeGraphql', () => {
  it('returns two providers', () => {
    const providers = provideMfeGraphql('investor');
    expect(providers).toHaveLength(2);
  });

  it('provides MFE_DOMAIN with the supplied literal', () => {
    const providers = provideMfeGraphql('advisory');
    const first = providers[0] as { provide: unknown; useValue: string };
    expect(first.provide).toBe(MFE_DOMAIN);
    expect(first.useValue).toBe('advisory');
  });

  it('provides GraphqlService as useClass: GraphqlService (forces a route-scoped instance)', () => {
    const providers = provideMfeGraphql('ledger');
    const second = providers[1] as { provide: unknown; useClass: unknown };
    expect(second.provide).toBe(GraphqlService);
    expect(second.useClass).toBe(GraphqlService);
  });

  it('passes the domain through verbatim for each of the four BFF domains', () => {
    for (const domain of ['investor', 'advisory', 'dashboard', 'ledger']) {
      const providers = provideMfeGraphql(domain);
      const first = providers[0] as { useValue: string };
      expect(first.useValue).toBe(domain);
    }
  });
});
