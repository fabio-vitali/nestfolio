import { eventName } from '@nestfolio/event-types';

/** Events PUBLISHED by portfolio-engine-ctrl */
export const PortfolioEngineEventTypes = {
  PORTFOLIO_COMPLETED: eventName('PORTFOLIO_COMPLETED'),
  PORTFOLIO_FAILED: eventName('PORTFOLIO_FAILED'),
  PORTFOLIO_CONSTRUCTION_PROPOSED: eventName('PORTFOLIO_CONSTRUCTION_PROPOSED'),
  REBALANCE_PLAN_PRODUCED: eventName('REBALANCE_PLAN_PRODUCED'),
  PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED: eventName('PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED'),
} as const;

/** Inbound event types consumed by portfolio-engine-ctrl */
export const HANDLED_EVENT_TYPES = new Set([
  eventName('CONSTRUCT_PORTFOLIO'),
  eventName('SEC_PROSPECTUS_UPDATED'),
  eventName('SEC_10K_UPDATED'),
]);

/** KB ingestion event types — routed to kb-ingestion-handler */
export const KB_INGESTION_EVENT_TYPES = new Set([
  eventName('SEC_PROSPECTUS_UPDATED'),
  eventName('SEC_10K_UPDATED'),
]);
