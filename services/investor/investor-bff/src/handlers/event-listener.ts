import { materializeToTable, toUow, skip, pickRequestContext, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { userRegistered } from '../transforms/user-registered';
import { notificationCreated } from '../transforms/notification-created';
import { balanceUpdated } from '../transforms/balance-updated';
import { onboardingCompleted } from '../transforms/onboarding-completed';
import { operatingModeChanged } from '../transforms/operating-mode-changed';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

export async function callAppSyncMutation(mutation: string, variables: Record<string, unknown>): Promise<void> {
  const appsyncUrl = process.env.APPSYNC_URL;
  const region = process.env.AWS_REGION ?? 'us-east-1';

  if (!appsyncUrl) {
    console.warn('APPSYNC_URL not set — skipping feature flag update');
    return;
  }
  const url = new URL(appsyncUrl);
  const body = JSON.stringify({ query: mutation, variables });

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'appsync',
    sha256: Sha256,
  });

  const request = {
    method: 'POST' as const,
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname,
    },
    body,
  };

  const signed = await signer.sign(request);
  const response = await fetch(appsyncUrl, {
    method: 'POST',
    headers: signed.headers as Record<string, string>,
    body,
  });

  if (!response.ok) {
    console.error('AppSync mutation failed', { status: response.status });
  }
}

const UPDATE_FEATURE_FLAG = `
  mutation UpdateFeatureFlag($name: String!, $enabled: Boolean!, $reason: String) {
    updateFeatureFlag(name: $name, enabled: $enabled, reason: $reason) {
      name
      enabled
      reason
    }
  }
`;

export function createHandlers(deps?: { profileRepo?: InvestorProfileRepository }) {
  return {
    [InvestorBffEventTypes.USER_REGISTERED]: (payload: EventPayload, ctx: EventContext) =>
      userRegistered(toUow(payload, ctx)),
    [InvestorCtrlEventTypes.NOTIFICATION_CREATED]: (payload: EventPayload, ctx: EventContext) =>
      notificationCreated(toUow(payload, ctx)),
    [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      balanceUpdated(toUow(payload, ctx)),
    [InvestorBffEventTypes.ONBOARDING_COMPLETED]: async (payload: EventPayload, ctx: EventContext) =>
      onboardingCompleted(payload, ctx),
    [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: (payload: EventPayload, ctx: EventContext) =>
      operatingModeChanged(payload, ctx),
    ['GO_LIVE_CONFIRMED']: async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject as Record<string, unknown>;
      const reqCtx = { ...pickRequestContext(ctx), userId: (subject.userId as string) as typeof ctx.userId };
      const profileRepo = deps?.profileRepo ?? new InvestorProfileRepository(process.env['TABLE_NAME']!);
      await profileRepo.setExecutionMode(reqCtx, 'simulation', 'live');
      return skip();
    },
    [InvestorBffEventTypes.BROKER_CIRCUIT_OPEN]: async (_payload: EventPayload, _ctx: EventContext) => {
      const flags = [
        { name: 'confirmDecision', enabled: false, reason: 'Broker connectivity issue' },
        { name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue' },
        { name: 'requestWithdrawal', enabled: false, reason: 'Broker connectivity issue' },
      ];
      for (const flag of flags) {
        await callAppSyncMutation(UPDATE_FEATURE_FLAG, flag);
      }
      return skip();
    },
    [InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED]: async (_payload: EventPayload, _ctx: EventContext) => {
      const flags = [
        { name: 'confirmDecision', enabled: true },
        { name: 'initiateDeposit', enabled: true },
        { name: 'requestWithdrawal', enabled: true },
      ];
      for (const flag of flags) {
        await callAppSyncMutation(UPDATE_FEATURE_FLAG, flag);
      }
      return skip();
    },
  };
}

export const handler = materializeToTable({
  serviceName: 'investor-bff',
  handlers: createHandlers(),
  errorEventType: 'INVESTOR_BFF_FAILED',
});
