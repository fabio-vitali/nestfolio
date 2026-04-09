import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { InvestorCtrlEventTypes } from './domain/events';

export class InvestorCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const triggerIngress = new Ingress(this, 'TriggerIngress', {
      state,
      eventTypes: [
        'ONBOARDING_COMPLETED',
        'MANDATE_CREATED',
        'GOAL_UPDATED',
        'DEPOSIT_INITIATED',
        'OPERATING_MODE_CHANGED',
        'DECISION_APPROVED',
        'ORDER_FILLED',
        'BALANCE_UPDATED',
        'ORDER_REJECTED',
        'DECISION_BLOCKED',
        'WITHDRAWAL_COMPLETED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'Notification': {
          insert: InvestorCtrlEventTypes.NOTIFICATION_CREATED,
          modify: InvestorCtrlEventTypes.NOTIFICATION_UPDATED,
        },
        'MonthlyReport': {
          insert: InvestorCtrlEventTypes.MONTHLY_REPORT_CREATED,
          modify: InvestorCtrlEventTypes.MONTHLY_REPORT_UPDATED,
        },
      },
    });

    this.addObservability({ ingress: triggerIngress, egress });
  }
}
