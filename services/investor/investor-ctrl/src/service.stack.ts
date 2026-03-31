import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';

export class InvestorCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const triggerIngress = new Ingress(this, 'TriggerIngress', {
      state,
      eventTypes: [
        'ONBOARDING_COMPLETED',
        'MANDATE_GRANTED',
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
        'Notification': 'NOTIFICATION',
        'MonthlyReport': 'MONTHLY_REPORT',
      },
    });

    this.addObservability({ ingress: triggerIngress, egress });
  }
}
