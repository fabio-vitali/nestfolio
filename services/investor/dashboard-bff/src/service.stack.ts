import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs';

export class DashboardBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { ...props, subsystem: 'investor', service: 'dashboard-bff', serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'BALANCE_UPDATED',
        'PORTFOLIO_UPDATED',
        'RECONCILIATION_COMPLETED',
        'DECISION_PACKET_CREATED',
        'USER_CONFIRMATION_REQUESTED',
        'DECISION_APPROVED',
        'DECISION_BLOCKED',
        'LEDGER_ENTRY_RECORDED',
        'ONBOARDING_COMPLETED',
        'GOAL_SET',
        'GOAL_UPDATED',
        'RISK_PROFILE_SET',
        'RISK_PROFILE_UPDATED',
      ],
    });

    new Facade(this, 'Facade', {
      jsResolvers: discoverJsResolvers(__dirname),
    });

    this.addObservability({ ingress });
  }
}
