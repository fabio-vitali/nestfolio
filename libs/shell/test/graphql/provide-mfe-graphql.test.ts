/** @jest-environment node */
jest.mock('@angular/core', () => ({
  InjectionToken: class { constructor(private desc: string) {} toString() { return `InjectionToken ${this.desc}`; } },
}));

import { MFE_DOMAIN, MFE_APPSYNC_GRAPHQL_URL } from '../../src/graphql/mfe-domain.token';
import { GraphqlService } from '../../src/graphql/graphql.service';
import { provideMfeGraphql } from '../../src/graphql/provide-mfe-graphql';

// Mock the GraphqlService import path used by provideMfeGraphql.
jest.mock('../../src/graphql/graphql.service', () => ({
  GraphqlService: class GraphqlServiceStub {},
}));

const stubFactory = () => 'wss://stub.appsync-realtime-api.us-east-1.amazonaws.com/graphql';

describe('provideMfeGraphql', () => {
  it('returns three providers', () => {
    const providers = provideMfeGraphql('investor', stubFactory);
    expect(providers).toHaveLength(3);
  });

  it('provides MFE_DOMAIN with the supplied literal', () => {
    const providers = provideMfeGraphql('advisory', stubFactory);
    const first = providers[0] as { provide: unknown; useValue: string };
    expect(first.provide).toBe(MFE_DOMAIN);
    expect(first.useValue).toBe('advisory');
  });

  it('provides MFE_APPSYNC_GRAPHQL_URL via the factory (deferred until DI resolution)', () => {
    let calls = 0;
    const factory = () => {
      calls++;
      return 'wss://lazy.example/graphql';
    };
    const providers = provideMfeGraphql('investor', factory);
    const second = providers[1] as { provide: unknown; useFactory: () => string };
    expect(second.provide).toBe(MFE_APPSYNC_GRAPHQL_URL);
    // Factory is wired but NOT called by provideMfeGraphql itself.
    expect(calls).toBe(0);
    // Calling the wired factory yields the URL.
    expect(second.useFactory()).toBe('wss://lazy.example/graphql');
    expect(calls).toBe(1);
  });

  it('provides GraphqlService as useClass: GraphqlService (forces a route-scoped instance)', () => {
    const providers = provideMfeGraphql('ledger', stubFactory);
    const third = providers[2] as { provide: unknown; useClass: unknown };
    expect(third.provide).toBe(GraphqlService);
    expect(third.useClass).toBe(GraphqlService);
  });

  it('passes the domain through verbatim for each of the four BFF domains', () => {
    for (const domain of ['investor', 'advisory', 'dashboard', 'ledger']) {
      const providers = provideMfeGraphql(domain, stubFactory);
      const first = providers[0] as { useValue: string };
      expect(first.useValue).toBe(domain);
    }
  });
});
