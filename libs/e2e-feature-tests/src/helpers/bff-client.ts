import {
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import type { FreshTenant } from './fresh-tenant';

export interface BffClients {
  investor: AppSyncClient;
  advisory: AppSyncClient;
  ledger: AppSyncClient;
  dashboard: AppSyncClient;
}

/**
 * Construct an AppSyncClient per BFF service, all authenticated with the
 * same Cognito tokens from the given tenant. Thin — does not hide anything.
 */
export function bffClient(ctx: IntegrationContext, tenant: FreshTenant): BffClients {
  return {
    investor: new AppSyncClient(ctx, tenant.cognitoTokens, 'investor-bff'),
    advisory: new AppSyncClient(ctx, tenant.cognitoTokens, 'advisory-bff'),
    ledger: new AppSyncClient(ctx, tenant.cognitoTokens, 'ledger-bff'),
    dashboard: new AppSyncClient(ctx, tenant.cognitoTokens, 'dashboard-bff'),
  };
}
