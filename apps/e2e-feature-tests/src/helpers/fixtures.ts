import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient as EbClient,
  ListRulesCommand,
  DisableRuleCommand,
  EnableRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { BalanceUpdatedSchema } from '@nestfolio/ledger-ctrl/contracts';
import { BrokerCtrlEventTypes } from '@nestfolio/broker-ctrl/events';
import type { FreshTenant } from './fresh-tenant';
import { bffClient, type BffClients } from './bff-client';
import { waitForGraphQL } from './wait-for-graphql';
import type { DecisionHistoryResponse } from './graphql-types';

/**
 * A Fixture is an async function that publishes whatever events are needed
 * to bring a fresh tenant to a specific observable precondition.
 * Fixtures receive BffClients so they can poll GraphQL to confirm
 * that prerequisite events have been materialized before proceeding.
 */
export type Fixture = (
  ctx: TestContext,
  tenant: FreshTenant,
  eb: EventBridgeClient,
  bff: BffClients,
) => Promise<FixtureResult>;

export interface FixtureResult {
  // Populated by fixtures that return identifiers (decisionId, depositId, etc.)
  [key: string]: unknown;
}

export async function applyFixtures(
  ctx: TestContext,
  tenant: FreshTenant,
  fixtures: Fixture[],
): Promise<FixtureResult> {
  const eb = new EventBridgeClient(ctx);
  const bff = bffClient(ctx, tenant);
  const merged: FixtureResult = {};
  for (const fixture of fixtures) {
    const result = await fixture(ctx, tenant, eb, bff);
    Object.assign(merged, result);
  }
  return merged;
}

/**
 * Seeds the minimum viable onboarded state:
 *   1. USER_REGISTERED — observed for cross-service propagation (no-op in investor-bff post-collapse)
 *   2. ONBOARDING_COMPLETED — materializes the composite InvestorProfile row + sibling MandateStatus + optional Deposit
 *   3. Wait for getProfile to confirm the composite row exists before downstream fixtures run.
 *
 * Matches the seeding chain used by services/investor/investor-bff/test/integration/.
 */
export function onboarded(overrides?: {
  operatingMode?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  capitalAmount?: number;
  currency?: string;
  mandateLevel?: 'ADVISORY' | 'DISCRETIONARY';
}): Fixture {
  return async (_ctx, tenant, eb, bff) => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorBffEventTypes.USER_REGISTERED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        email: `${tenant.userId}@integ-e2e.example`,
      },
    });
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorBffEventTypes.ONBOARDING_COMPLETED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        goal: { objective: 'GROWTH' },
        horizonYears: 10,
        accountMode: 'simulation',
        capitalAmount: overrides?.capitalAmount ?? 100_000,
        currency: overrides?.currency ?? 'USD',
        riskTolerance: 7,
        riskExperience: 5,
        operatingMode: overrides?.operatingMode ?? 'BALANCED',
        mandateLevel: overrides?.mandateLevel,  // optional — transform defaults absent to DISCRETIONARY
        mandateAccepted: true,
      },
    });
    // Poll getProfile to confirm the composite InvestorProfile row has been materialized
    // by onboarding-completed's Put. Downstream fixtures (funded, withDecision, etc.) can
    // race against this if the profile isn't ready, and any test asserting on
    // mandate/operatingMode shape needs a materialized row.
    await waitForGraphQL<{ getProfile: { tenantId: string } }>(
      bff.investor,
      `query { getProfile { tenantId } }`,
      {},
      (r) => !!r.getProfile?.tenantId,
      { timeoutMs: 60_000 },
    );
    return {};
  };
}

/**
 * Waits for the InvestorProfileSnapshot row that IP-ctrl's Bedrock AgentCore
 * agent writes after onboarding (user-goals Haiku + risk-assessment Sonnet).
 *
 * Compose this AFTER onboarded() ONLY in scenarios that drive a real
 * decision-workflow-ctrl cycle: the DWC per-cycle Step Function reads the
 * DWC-local mirror of this snapshot (materialised by SnapshotProjectorIngress
 * CDC), so the snapshot must exist before the cycle triggers. Scenarios that
 * just need an onboarded tenant — or use the synthetic withDecision() that
 * short-circuits the SF — must NOT compose this: it costs agent-invoke latency.
 */
export function withProfileSnapshot(): Fixture {
  return async (ctx, tenant, _eb, _bff) => {
    const ipTableName = await ctx.ssm.tableName('investor-profile-ctrl');
    const ddbClient = new DynamoDBClient({ region: ctx.region });
    const ddbDoc = DynamoDBDocumentClient.from(ddbClient);
    try {
      // 360s budget: the IP-ctrl AgentCore invoke can hit the account maxVms
      // quota; when it does, the event-processor (with quota errors now
      // retryable) lets SQS redrive the message. One full native redrive is
      // IP-ctrl ingress visibility timeout (240s) + agent invoke (~90s p99) +
      // CDC/EB/adapter (~20s). See
      // docs/superpowers/specs/2026-05-21-agentcore-invocation-resilience-design.md
      const deadline = Date.now() + 360_000;
      while (Date.now() < deadline) {
        const r = await ddbDoc.send(new GetCommand({
          TableName: ipTableName,
          Key: {
            pk: `InvestorProfileSnapshot#${tenant.tenantId}#${tenant.userId}`,
            sk: 'InvestorProfileSnapshot',
          },
        }));
        if (r.Item) return {};
        await new Promise(res => setTimeout(res, 2_000));
      }
      throw new Error('withProfileSnapshot(): InvestorProfileSnapshot not materialised within 360s');
    } finally {
      ddbClient.destroy();
    }
  };
}

/**
 * Seeds cash balance by publishing BALANCE_UPDATED. That event materializes
 * the CashBalance row at pk=InvestorProfile#{tenantId}#{userId}, which
 * requestWithdrawal's ConditionExpression depends on.
 */
export function funded(opts: { cashBalanceCents: number }): Fixture {
  return async (ctx, tenant, eb, _bff) => {
    // The deployed investor-bff parses BALANCE_UPDATED via the producer's
    // BalanceUpdatedSchema, which REQUIRES `snapshot` — the real ledger-ctrl
    // producer always wraps it (snapshot-to-events.ts). A synthetic event
    // missing `snapshot` is rejected with a ZodError, so CashBalance never
    // materializes and this fixture times out 60s later. Validate the emitted
    // detail against the producer contract here so a co-wrong fixture fails
    // loudly at emit time, not via a downstream poll timeout (the
    // event-subject-contracts lesson: fixtures must emit the shape the real
    // producer emits).
    const detail = {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      cashBalanceCents: opts.cashBalanceCents,
      snapshot: {
        positions: {},
        cashBalanceCents: opts.cashBalanceCents,
        lastEventSequence: 0,
      },
    };
    BalanceUpdatedSchema.parse(detail);
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: LedgerCtrlEventTypes.BALANCE_UPDATED,
      detail,
    });

    // Poll for CashBalance materialization. The investor-bff event-listener
    // projects BALANCE_UPDATED into a CashBalance DDB row that downstream
    // mutations (e.g. requestWithdrawal) depend on via ConditionExpression.
    const tableName = await ctx.ssm.tableName('investor-bff');
    const ddbClient = new DynamoDBClient({ region: ctx.region });
    const ddbDoc = DynamoDBDocumentClient.from(ddbClient);
    try {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const result = await ddbDoc.send(new GetCommand({
          TableName: tableName,
          Key: {
            pk: `InvestorProfile#${tenant.tenantId}#${tenant.userId}`,
            sk: 'CashBalance',
          },
        }));
        if (result.Item) return {};
        await new Promise(r => setTimeout(r, 2_000));
      }
      throw new Error('funded(): CashBalance not materialized within 60s');
    } finally {
      ddbClient.destroy();
    }
  };
}

export type DecisionTrigger = 'INITIAL_ALLOCATION' | 'REBALANCE' | 'ADJUSTMENT';
export type ProposedTrade = { symbol: string; side: 'BUY' | 'SELL'; quantityOrAmountCents: number };

const DEFAULT_PROPOSED_TRADES: ProposedTrade[] = [
  { symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500_000 },
];

/**
 * Publishes one synthetic DecisionPacket CDC snapshot (DECISION_PACKET_CREATED
 * or DECISION_PACKET_UPDATED) to advisory-bff, modelling what the producer
 * (decision-workflow-ctrl) emits after each SF/user-callback step.
 *
 * Post-w3 (versioned read model) the advisory-bff `decision-snapshot` transform
 * projects this via `projectVersioned(…, { version: subject.__version })`. The
 * version guard (`attribute_not_exists(pk) OR #__version < :version`) makes the
 * CREATE-then-UPDATE sequence order-safe, but it CANNOT evaluate when
 * `__version` is absent — so every synthetic snapshot MUST carry a numeric
 * `version`, and a terminal snapshot MUST use a strictly higher one than the
 * row it supersedes. The transform also drops degraded snapshots (no explanation
 * AND no trades), so we always send both.
 */
export async function emitDecisionSnapshot(
  eb: EventBridgeClient,
  tenant: FreshTenant,
  opts: {
    decisionId: string;
    trigger: DecisionTrigger;
    status: string;
    version: number;
    proposedTrades?: ProposedTrade[];
    explanation?: string;
    confirmedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
    /** Defaults to DECISION_PACKET_UPDATED; pass CREATED for the first snapshot. */
    detailType?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await eb.putEvent({
    bus: 'advisory',
    targetService: 'advisory-bff',
    detailType: opts.detailType ?? DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
    detail: {
      __version: opts.version,
      tenantId: tenant.tenantId,
      decisionId: opts.decisionId,
      trigger: opts.trigger,
      status: opts.status,
      proposedTrades: opts.proposedTrades ?? DEFAULT_PROPOSED_TRADES,
      explanation: opts.explanation ?? 'E2E test synthetic decision',
      confirmationRequired: true,
      confirmedAt: opts.confirmedAt,
      rejectedAt: opts.rejectedAt,
      rejectionReason: opts.rejectionReason,
      createdAt: now,
      updatedAt: now,
    },
  });
}

/**
 * Seeds a PENDING decision read-model on advisory-bff by publishing a synthetic
 * versioned DECISION_PACKET_CREATED (`__version: 1`). Returns the generated
 * decisionId so scenarios can reference it in confirmDecision/rejectDecision
 * mutations. To drive the row to a terminal status, follow up with
 * `emitDecisionSnapshot(… { version: 2, status: 'CONFIRMED' | 'REJECTED' })` —
 * the confirm/reject resolvers are intent-only post-w3, so the terminal status
 * only arrives via the producer's higher-versioned snapshot.
 */
export function withDecision(opts: {
  trigger: DecisionTrigger;
  proposedTrades?: ProposedTrade[];
  explanation?: string;
}): Fixture {
  return async (_ctx, tenant, eb, _bff) => {
    const decisionId = `e2e-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await emitDecisionSnapshot(eb, tenant, {
      decisionId,
      trigger: opts.trigger,
      status: 'PENDING',
      version: 1,
      proposedTrades: opts.proposedTrades,
      explanation: opts.explanation,
      detailType: DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
    });
    return { decisionId };
  };
}

/**
 * Triggers the LIVE advisory decision pipeline end-to-end (decision-workflow-ctrl
 * Step Function → 4 advisory agent services → AgentCore data-plane → DECISION_PACKET_*
 * CDC chain → advisory-bff materialization). Unlike `withDecision`, this fixture
 * does NOT short-circuit the agent pipeline by emitting a synthetic
 * DECISION_PACKET_CREATED. It publishes a real workflow trigger event and polls
 * advisory-bff GraphQL until a packet appears.
 *
 * Use sparingly: each call drives a real Bedrock wave (30–90 s). Most decision
 * scenarios should keep using `withDecision` for fast, deterministic seeding —
 * pick `withLiveDecision` only when verifying the AgentCore transport itself.
 *
 * Post-collapse (2026-05-10): the SF triggers on MANDATE_SNAPSHOT_CREATED (CDC
 * of decision-workflow-ctrl-owned MandateSnapshot:INSERT) for first decisions,
 * or INVESTOR_PROFILE_UPDATED for re-decisions on profile edits. To get the
 * natural MANDATE_SNAPSHOT_CREATED chain firing, this fixture publishes
 * MANDATE_ISSUED (which the mandate-projector materialises into MandateSnapshot
 * → CDC → MANDATE_SNAPSHOT_CREATED → SF). For re-decision triggers,
 * INVESTOR_PROFILE_UPDATED is published directly.
 *
 * `expectedStatus` defaults to undefined (any packet counts). Set to
 * 'PENDING_CONFIRMATION' to verify the full L2 path through user_confirmation_requested.
 */
export function withLiveDecision(opts?: {
  trigger?: 'MANDATE_SNAPSHOT_CREATED' | 'INVESTOR_PROFILE_UPDATED';
  operatingMode?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  expectedStatus?: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Fixture {
  return async (_ctx, tenant, eb, bff) => {
    const trigger = opts?.trigger ?? 'MANDATE_SNAPSHOT_CREATED';
    const operatingMode = opts?.operatingMode ?? 'BALANCED';
    if (trigger === 'MANDATE_SNAPSHOT_CREATED') {
      // Natural chain: MANDATE_ISSUED → mandate-projector materialises a
      // MandateSnapshot row in decision-workflow-ctrl's local table →
      // DDB-stream CDC emits MANDATE_SNAPSHOT_CREATED → EB Rule starts the SF.
      // The SF unconditionally LookupMandateSnapshot via Direct DDB GetItem,
      // synthesizes investorProfile = { operatingMode }, and proceeds through
      // the 4-agent pipeline → DECISION_PACKET_CREATED → advisory-bff.
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'MANDATE_ISSUED',
        detail: {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          mandateId: `e2e-mandate-${Date.now()}`,
          level: 'ADVISORY',
          status: 'ACTIVE',
          operatingMode,
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          rebalanceCadence: 'MONTHLY',
          effectiveDate: new Date().toISOString(),
        },
      });
    } else {
      // Re-decision path: INVESTOR_PROFILE_UPDATED published directly. The
      // MandateSnapshot projection is guaranteed materialised by then (an
      // earlier MANDATE_ISSUED ran during onboarding).
      await eb.putEvent({
        bus: 'advisory',
        targetService: 'decision-workflow-ctrl',
        detailType: 'INVESTOR_PROFILE_UPDATED',
        detail: {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          operatingMode,
          accountMode: { mode: 'simulation', capitalAmount: 100_000, currency: 'USD' },
          goal: { objective: 'GROWTH', targetAmountCents: 1_000_000, currency: 'USD', timeHorizonMonths: 120, targetReturn: 0.07 },
          riskProfile: { score: 7, band: { minEquity: 0.5, maxEquity: 0.8 }, toleranceResponse: 'MEDIUM', experienceLevel: 'INTERMEDIATE' },
          mandate: {
            mandateId: `e2e-mandate-${Date.now()}`,
            level: 'ADVISORY',
            status: 'ACTIVE',
            monthlyTurnoverCapPercent: 10,
            maxSingleTradePercent: 5,
            rebalanceCadence: 'MONTHLY',
            effectiveDate: new Date().toISOString(),
          },
        },
      });
    }

    const expectedStatus = opts?.expectedStatus;
    const result = await waitForGraphQL<DecisionHistoryResponse>(
      bff.advisory,
      `query History { getDecisionHistory(limit: 10) { items { decisionId status trigger } nextCursor } }`,
      {},
      (r) => {
        const items = r.getDecisionHistory?.items ?? [];
        if (items.length === 0) return false;
        if (!expectedStatus) return true;
        return items.some((i) => i.status === expectedStatus);
      },
      // On dev the per-cycle SF runs 90–110s (parallel projection lookups +
      // PE invoke + AN invoke + compliance wait) and advisory-bff's CDC
      // publisher adds another 5–20s before getDecisionHistory surfaces it.
      // 180s leaves headroom on warm-Lambda paths and covers a single PE/AN
      // retry on dev. Tightening further requires reducing the actual
      // end-to-end cycle latency, not just the test timeout.
      { timeoutMs: opts?.timeoutMs ?? 180_000, intervalMs: opts?.intervalMs ?? 5_000 },
    );

    const items = result.getDecisionHistory.items;
    const item = expectedStatus
      ? items.find((i) => i.status === expectedStatus)!
      : items[0];
    return {
      decisionId: item.decisionId,
      pipelineMetadata: { trigger: item.trigger, status: item.status },
    };
  };
}

/**
 * Seeds a CREATED notification on investor-bff by publishing a synthetic
 * NOTIFICATION_CREATED. Returns the generated notificationId.
 */
export function withNotification(opts: {
  title: string;
  body: string;
  channel?: 'IN_APP' | 'EMAIL' | 'PUSH' | 'SMS';
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Fixture {
  return async (_ctx, tenant, eb, _bff) => {
    const notificationId = `e2e-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorCtrlEventTypes.NOTIFICATION_CREATED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        notificationId,
        channel: opts.channel ?? 'IN_APP',
        title: opts.title,
        body: opts.body,
        relatedEntityType: opts.relatedEntityType ?? 'System',
        relatedEntityId: opts.relatedEntityId ?? 'system',
      },
    });
    return { notificationId };
  };
}

/**
 * Seeds portfolio holdings by publishing one synthetic ORDER_FILLED per
 * holding on the execution bus. The ledger-ctrl reducer projects these
 * into the ledger-bff read model (Portfolio / Positions).
 */
export function withHoldings(
  holdings: Array<{ symbol: string; quantity: number; fillPrice: number }>,
): Fixture {
  return async (_ctx, tenant, eb, _bff) => {
    for (const h of holdings) {
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: BrokerCtrlEventTypes.ORDER_FILLED,
        detail: {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          orderId: `e2e-order-${h.symbol}-${Date.now()}`,
          symbol: h.symbol,
          quantity: h.quantity,
          fillPrice: h.fillPrice,
          filledAt: new Date().toISOString(),
          side: 'BUY',
        },
      });
    }
    return {};
  };
}

// Heal SM auto-closes the breaker within ~1s of BROKER_CIRCUIT_OPEN by health-checking
// Alpaca and racing the BFF feature-flag disable. We disable the EB trigger rule for the
// duration of the test so the breaker stays OPEN until closeBreakerFixture re-enables it.
const HEAL_RULE_PREFIX_SUFFIX = '-broker-alpaca-adpt-HealStateMachine';

async function findHealRuleName(ctx: TestContext): Promise<string> {
  const eb = new EbClient({ region: ctx.region });
  try {
    const result = await eb.send(new ListRulesCommand({
      EventBusName: `${ctx.prefix}-execution-event-bus`,
      NamePrefix: `${ctx.prefix}${HEAL_RULE_PREFIX_SUFFIX}`,
    }));
    const rule = result.Rules?.[0];
    if (!rule?.Name) {
      throw new Error(
        `withBreakerOpen: heal SM EB rule not found (prefix=${ctx.prefix}${HEAL_RULE_PREFIX_SUFFIX})`,
      );
    }
    return rule.Name;
  } finally {
    eb.destroy();
  }
}

async function setHealRuleState(ctx: TestContext, ruleName: string, enabled: boolean): Promise<void> {
  const eb = new EbClient({ region: ctx.region });
  try {
    const cmd = enabled
      ? new EnableRuleCommand({ Name: ruleName, EventBusName: `${ctx.prefix}-execution-event-bus` })
      : new DisableRuleCommand({ Name: ruleName, EventBusName: `${ctx.prefix}-execution-event-bus` });
    await eb.send(cmd);
  } finally {
    eb.destroy();
  }
}

/**
 * Opens the circuit breaker on broker-alpaca-adpt by writing a CircuitBreaker
 * DDB record and a NormalizedEvent (which triggers CDC → BROKER_CIRCUIT_OPEN).
 * Simulates what the handler does when the Alpaca API is unreachable.
 *
 * Disables the heal SM EB trigger BEFORE the DDB writes so the BROKER_CIRCUIT_OPEN
 * event reaches the investor-bff feature-flag handler without being raced by the
 * heal SM auto-closing the breaker. closeBreakerFixture re-enables the rule.
 */
export function withBreakerOpen(): Fixture {
  return async (ctx, tenant, _eb, _bff) => {
    const ruleName = await findHealRuleName(ctx);
    await setHealRuleState(ctx, ruleName, false);

    const tableName = await ctx.ssm.tableName('broker-alpaca-adpt');
    const ddbClient = new DynamoDBClient({ region: ctx.region });
    const ddb = DynamoDBDocumentClient.from(ddbClient);
    const now = new Date().toISOString();

    try {
      // Open the breaker
      await ddb.send(new PutCommand({
        TableName: tableName,
        Item: {
          pk: 'CircuitBreaker#alpaca',
          sk: 'CircuitBreaker',
          __typename: 'CircuitBreaker',
          state: 'OPEN',
          adapter: 'alpaca',
          openedAt: now,
          reason: 'E2E test — simulated failure',
        },
      }));

      // Write NormalizedEvent to trigger CDC → BROKER_CIRCUIT_OPEN
      await ddb.send(new PutCommand({
        TableName: tableName,
        Item: {
          pk: `NormalizedEvent#${tenant.tenantId}#CIRCUIT_BREAKER`,
          sk: `BROKER_CIRCUIT_OPEN#${now}`,
          __typename: 'NormalizedEvent',
          tenantId: tenant.tenantId,
          userId: 'SYSTEM',
          region: 'us-east-1',
          adapter: 'alpaca',
          timestamp: now,
        },
      }));
    } finally {
      ddbClient.destroy();
    }

    return {};
  };
}

/**
 * Closes the circuit breaker by updating the DDB record and writing a
 * NormalizedEvent (which triggers CDC → BROKER_CIRCUIT_CLOSED).
 *
 * Re-enables the heal SM EB trigger that withBreakerOpen disabled, so the rule
 * returns to its production state regardless of test outcome.
 */
export function closeBreakerFixture(): Fixture {
  return async (ctx, tenant, _eb, _bff) => {
    const tableName = await ctx.ssm.tableName('broker-alpaca-adpt');
    const ddbClient = new DynamoDBClient({ region: ctx.region });
    const ddb = DynamoDBDocumentClient.from(ddbClient);
    const now = new Date().toISOString();

    try {
      // Close the breaker
      await ddb.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: 'CircuitBreaker#alpaca', sk: 'CircuitBreaker' },
        UpdateExpression: 'SET #st = :st, closedAt = :ca',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':st': 'CLOSED', ':ca': now },
      }));

      // Write NormalizedEvent to trigger CDC → BROKER_CIRCUIT_CLOSED
      await ddb.send(new PutCommand({
        TableName: tableName,
        Item: {
          pk: `NormalizedEvent#${tenant.tenantId}#CIRCUIT_BREAKER`,
          sk: `BROKER_CIRCUIT_CLOSED#${now}`,
          __typename: 'NormalizedEvent',
          tenantId: tenant.tenantId,
          userId: 'SYSTEM',
          region: 'us-east-1',
          adapter: 'alpaca',
          timestamp: now,
        },
      }));
    } finally {
      ddbClient.destroy();
    }

    try {
      const ruleName = await findHealRuleName(ctx);
      await setHealRuleState(ctx, ruleName, true);
    } catch (err) {
      // Best-effort: log but don't fail the test on cleanup.
      // eslint-disable-next-line no-console
      console.warn('closeBreakerFixture: failed to re-enable heal SM rule', err);
    }

    return {};
  };
}
