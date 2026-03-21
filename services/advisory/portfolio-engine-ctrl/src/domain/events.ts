/** Events PUBLISHED by portfolio-engine-ctrl */
export const PortfolioEngineEventTypes = {
  PORTFOLIO_COMPLETED: 'PORTFOLIO_COMPLETED',
  PORTFOLIO_CONSTRUCTION_PROPOSED: 'PORTFOLIO_CONSTRUCTION_PROPOSED',
  REBALANCE_PLAN_PRODUCED: 'REBALANCE_PLAN_PRODUCED',
} as const;

/** Inbound event types consumed by portfolio-engine-ctrl */
export const HANDLED_EVENT_TYPES = new Set([
  'CONSTRUCT_PORTFOLIO',
  'SEC_PROSPECTUS_UPDATED',
  'SEC_10K_UPDATED',
]);

/** KB ingestion event types — routed to kb-ingestion-handler */
export const KB_INGESTION_EVENT_TYPES = new Set([
  'SEC_PROSPECTUS_UPDATED',
  'SEC_10K_UPDATED',
]);
