import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
import { InvestorBffEventTypes } from './domain/events';

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
        'Goal': {
          insert: InvestorBffEventTypes.GOAL_CREATED,
          modify: InvestorBffEventTypes.GOAL_UPDATED,
        },
        'RiskProfile': {
          insert: InvestorBffEventTypes.RISK_PROFILE_CREATED,
          modify: InvestorBffEventTypes.RISK_PROFILE_UPDATED,
        },
        'Mandate': {
          insert: InvestorBffEventTypes.MANDATE_CREATED,
          modify: InvestorBffEventTypes.MANDATE_UPDATED,
        },
        'OperatingModeRecord': {
          insert: InvestorBffEventTypes.OPERATING_MODE_SELECTED,
          modify: InvestorBffEventTypes.OPERATING_MODE_CHANGED,
        },
        'InvestorProfile': {
          insert: InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
          modify: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
        },
        'Deposit': {
          insert: InvestorBffEventTypes.DEPOSIT_INITIATED,
          modify: InvestorBffEventTypes.DEPOSIT_UPDATED,
        },
        'Withdrawal': {
          insert: InvestorBffEventTypes.WITHDRAWAL_REQUESTED,
          modify: InvestorBffEventTypes.WITHDRAWAL_UPDATED,
        },
        'ExecutionModeChange': {
          insert: InvestorBffEventTypes.EXECUTION_MODE_CHANGED,
          modify: InvestorBffEventTypes.EXECUTION_MODE_CHANGE_UPDATED,
        },
        'Notification': { modify: InvestorBffEventTypes.NOTIFICATION_READ },
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
