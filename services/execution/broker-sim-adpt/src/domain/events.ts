import { eventName } from '@nestfolio/event-types';

export const BrokerSimEventTypes = {
  // Inbound (from broker-ctrl)
  SIM_ORDER_REQUESTED: eventName('SIM_ORDER_REQUESTED'),
  SIM_DEPOSIT_INITIATED: eventName('SIM_DEPOSIT_INITIATED'),
  SIM_WITHDRAWAL_REQUESTED: eventName('SIM_WITHDRAWAL_REQUESTED'),

  // Outbound (CDC)
  SIM_ORDER_FILLED: eventName('SIM_ORDER_FILLED'),
  SIM_ORDER_REJECTED: eventName('SIM_ORDER_REJECTED'),
  SIM_DEPOSIT_COMPLETED: eventName('SIM_DEPOSIT_COMPLETED'),
  SIM_WITHDRAWAL_COMPLETED: eventName('SIM_WITHDRAWAL_COMPLETED'),
} as const;
