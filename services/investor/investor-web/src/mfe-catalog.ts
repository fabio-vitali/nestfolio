/**
 * Single source of truth for which BFFs CloudFront wires behaviors for.
 *
 * investor-web's distribution serves /mfe/<key>/* for every BFF, and
 * /graphql/<domain> + /realtime/<domain> for every Facade-bearing BFF.
 * onboarding-bff is the documented exception — it has no Facade (CopilotKit
 * bridge instead, served by /api/copilotkit*).
 *
 * Adding a new MFE = one entry here + a new BFF stack with `MfeBucket`
 * (and `Facade`, if it has GraphQL).
 */
export interface MfeCatalogEntry {
  /** URL key under /mfe/<key>/* and the <domain> in /graphql/<domain>. */
  readonly key: string;
  /** CDK subsystem (services/<subsystem>/<service>). */
  readonly subsystem: string;
  /** BFF service name; SSM exports live under /nestfolio/<prefix>-<service>/. */
  readonly service: string;
  /** True if the BFF has a Facade (AppSync API). False = no /graphql or /realtime behavior. */
  readonly hasFacade: boolean;
}

export const MFE_CATALOG = [
  { key: 'investor',   subsystem: 'investor', service: 'investor-bff',   hasFacade: true  },
  { key: 'advisory',   subsystem: 'advisory', service: 'advisory-bff',   hasFacade: true  },
  { key: 'ledger',     subsystem: 'ledger',   service: 'ledger-bff',     hasFacade: true  },
  { key: 'dashboard',  subsystem: 'investor', service: 'dashboard-bff',  hasFacade: true  },
  { key: 'onboarding', subsystem: 'investor', service: 'onboarding-bff', hasFacade: false },
] as const satisfies readonly MfeCatalogEntry[];
