import type { z, ZodTypeAny } from 'zod';
import { mandateEventSubjects, investorFundingEventSubjects } from '@nestfolio/investor-adpt/domain';
import { ledgerCtrlEventSubjects } from '@nestfolio/ledger-ctrl/contracts';
import { reconciliationCtrlEventSubjects } from '@nestfolio/reconciliation-ctrl/contracts';
import { investorBffEventSubjects } from '@nestfolio/investor-bff/contracts';
import { onboardingBffEventSubjects } from '@nestfolio/onboarding-bff/contracts';
import { investorCtrlEventSubjects } from '@nestfolio/investor-ctrl/contracts';
import { decisionWorkflowEventSubjects } from '@nestfolio/decision-workflow-ctrl/contracts';
import { complianceCtrlEventSubjects } from '@nestfolio/compliance-ctrl/contracts';
import { portfolioEngineCtrlEventSubjects } from '@nestfolio/portfolio-engine-ctrl/contracts';
import { advisoryNarrativeCtrlEventSubjects } from '@nestfolio/advisory-narrative-ctrl/contracts';
import { investorProfileCtrlEventSubjects } from '@nestfolio/investor-profile-ctrl/contracts';
import { marketIntelligenceCtrlEventSubjects } from '@nestfolio/market-intelligence-ctrl/contracts';
import { yahooFinanceAdptEventSubjects } from '@nestfolio/yahoo-finance-adpt/contracts';
import { secEdgarAdptEventSubjects } from '@nestfolio/sec-edgar-adpt/contracts';
import { alphaVantageAdptEventSubjects } from '@nestfolio/alpha-vantage-adpt/contracts';
import { fredAdptEventSubjects } from '@nestfolio/fred-adpt/contracts';
import { marketwatchAdptEventSubjects } from '@nestfolio/marketwatch-adpt/contracts';
import { advisoryBffEventSubjects } from '@nestfolio/advisory-bff/contracts';
import { brokerAlpacaAdptEventSubjects } from '@nestfolio/broker-alpaca-adpt/contracts';
import { brokerCtrlEventSubjects } from '@nestfolio/broker-ctrl/contracts';
import { brokerSimAdptEventSubjects } from '@nestfolio/broker-sim-adpt/contracts';

/**
 * The single typed registry of `event detailType → producer subject schema`, composed
 * from each producer's own event-subject map (the producer remains the source of truth).
 * Each retrofit phase adds its domain's producer maps here. A typed fixture references
 * this registry so a missing/extra/mistyped subject field, an identity field in the
 * subject, or an unknown event name is a COMPILE error; `putEvent` also runs
 * `EventSubjects[detailType].parse(subject)` as a runtime backstop.
 */
export const EventSubjects = {
  ...mandateEventSubjects,
  ...investorFundingEventSubjects,
  ...ledgerCtrlEventSubjects,
  ...reconciliationCtrlEventSubjects,
  ...investorBffEventSubjects,
  ...onboardingBffEventSubjects,
  ...investorCtrlEventSubjects,
  ...decisionWorkflowEventSubjects,
  ...complianceCtrlEventSubjects,
  ...portfolioEngineCtrlEventSubjects,
  ...advisoryNarrativeCtrlEventSubjects,
  ...investorProfileCtrlEventSubjects,
  ...marketIntelligenceCtrlEventSubjects,
  ...yahooFinanceAdptEventSubjects,
  ...secEdgarAdptEventSubjects,
  ...alphaVantageAdptEventSubjects,
  ...fredAdptEventSubjects,
  ...marketwatchAdptEventSubjects,
  ...advisoryBffEventSubjects,
  ...brokerAlpacaAdptEventSubjects,
  ...brokerCtrlEventSubjects,
  ...brokerSimAdptEventSubjects,
} as const satisfies Record<string, ZodTypeAny>;

/** Union of all registered event names (detailTypes). */
export type RegisteredEventName = keyof typeof EventSubjects;

/** The DRY producer subject type for a registered event name. */
export type SubjectOf<K extends RegisteredEventName> = z.infer<(typeof EventSubjects)[K]>;
