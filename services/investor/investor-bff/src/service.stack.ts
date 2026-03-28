import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';

export class InvestorBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: ['USER_REGISTERED', 'NOTIFICATION_CREATED', 'BALANCE_UPDATED', 'ONBOARDING_COMPLETED', 'GO_LIVE_CONFIRMED'],
    });

    const egress = new Egress(this, 'Egress', {
      state,
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
      state,
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['requestAccountClosure'],
      }),
    });

    this.addObservability({ ingress, egress });
  }
}
