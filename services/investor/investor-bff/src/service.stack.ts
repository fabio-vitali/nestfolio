import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';

export class InvestorBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['USER_REGISTERED', 'NOTIFICATION_CREATED', 'BALANCE_UPDATED', 'ONBOARDING_COMPLETED'],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: [
        'Goal',
        'RiskProfile',
        'Mandate',
        'OperatingModeRecord',
        'InvestorProfile',
        'Deposit',
        'Withdrawal',
        'ExecutionModeChange',
      ],
    });

    new Facade(this, 'Facade', {
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['requestAccountClosure'],
      }),
    });

    this.addObservability({ ingress, egress });
  }
}
