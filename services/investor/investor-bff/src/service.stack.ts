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
      eventTypes: {
        'Goal': 'GOAL',
        'RiskProfile': 'RISK_PROFILE',
        'Mandate': 'MANDATE',
        'OperatingModeRecord': { insert: 'OPERATING_MODE_SELECTED', modify: 'OPERATING_MODE_CHANGED' },
        'InvestorProfile': 'INVESTOR_PROFILE',
        'Deposit': { insert: 'DEPOSIT_INITIATED', modify: 'DEPOSIT_UPDATED' },
        'Withdrawal': { insert: 'WITHDRAWAL_REQUESTED', modify: 'WITHDRAWAL_UPDATED' },
        'ExecutionModeChange': { insert: 'EXECUTION_MODE_CHANGED', modify: 'EXECUTION_MODE_CHANGE_UPDATED' },
      },
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
