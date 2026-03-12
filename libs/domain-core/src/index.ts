// @nestfolio/domain-core — Nestfolio-specific event types, schemas, and domain models

// shared
export {
  BusEventSchema,
  TenantContextSchema,
  EditEventSchema,
  EditOperationSchema,
} from './shared/types';
export type {
  BusEvent,
  TenantContext,
  EditEvent,
  EditOperation,
} from './shared/types';
export {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
} from './shared/errors';

// investor
export { InvestorEventTypes } from './investor/events';
export type { InvestorEventType } from './investor/events';
export {
  MandateGrantedSchema,
  GoalUpdatedSchema,
  RiskProfileUpdatedSchema,
  OnboardingCompletedSchema,
  DepositInitiatedSchema,
} from './investor/schemas';
export type {
  MandateGrantedEvent,
  GoalUpdatedEvent,
  RiskProfileUpdatedEvent,
  OnboardingCompletedEvent,
  DepositInitiatedEvent,
} from './investor/schemas';
export type {
  InvestorProfile,
  Goal,
  RiskProfile,
  Mandate,
  OperatingMode,
  MandateLevel,
  RebalanceCadence,
  Notification,
  NotificationChannel,
  NotificationStatus,
} from './investor/models';

// advisory
export { AdvisoryEventTypes } from './advisory/events';
export type { AdvisoryEventType } from './advisory/events';
export {
  DecisionPacketCreatedSchema,
  DecisionApprovedSchema,
  DecisionBlockedSchema,
  UserConfirmationRequestedSchema,
} from './advisory/schemas';
export type {
  DecisionPacketCreatedEvent,
  DecisionApprovedEvent,
  DecisionBlockedEvent,
  UserConfirmationRequestedEvent,
} from './advisory/schemas';
export type {
  DecisionPacket,
  ComplianceCheck,
  AgentInvocation,
  DecisionStatus,
  ComplianceLevel,
  ComplianceResult,
  ProposedTrade,
} from './advisory/models';

// execution
export { ExecutionEventTypes } from './execution/events';
export type { ExecutionEventType } from './execution/events';
export {
  OrderSubmittedSchema,
  OrderFilledSchema,
  DepositDetectedSchema,
  PortfolioDriftDetectedSchema,
} from './execution/schemas';
export type {
  OrderSubmittedEvent,
  OrderFilledEvent,
  DepositDetectedEvent,
  PortfolioDriftDetectedEvent,
} from './execution/schemas';
export type {
  Order,
  Portfolio,
  Position,
  Reconciliation,
  OrderStatus,
  OrderSide,
  OrderType,
  ReconciliationStatus,
} from './execution/models';

// ledger
export { LedgerEventTypes } from './ledger/events';
export type { LedgerEventType } from './ledger/events';
