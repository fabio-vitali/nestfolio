import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Egress } from '@nestfolio/cdk-constructs';

export class InvestorCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { ...props, subsystem: 'investor', service: 'investor-ctrl', serviceDir: __dirname });

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
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['Notification', 'MonthlyReport'],
    });

    this.addObservability({ ingress: triggerIngress, egress });
  }
}
