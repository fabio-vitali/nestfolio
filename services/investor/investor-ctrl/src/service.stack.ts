import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';

export class InvestorCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const triggerIngress = new Ingress(this, 'TriggerIngress', {
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
      publishableTypes: ['Notification', 'MonthlyReport'],
    });

    this.addObservability({ ingress: triggerIngress, egress });
  }
}
