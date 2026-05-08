import { join } from 'path';
import { Construct } from 'constructs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
import { MfeBucket } from '@nestfolio/cdk-constructs/extensions';
import { InvestorBffEventTypes } from './domain/events';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';

export class InvestorBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const facade = new Facade(this, 'Facade', {
      state,
      enableIamAuth: true,
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['requestAccountClosure'],
        preSteps: {
          initiateDeposit: ['check-feature-flag.fn.js'],
          requestWithdrawal: ['check-feature-flag.fn.js'],
        },
      }),
    });

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        InvestorBffEventTypes.USER_REGISTERED,
        InvestorCtrlEventTypes.NOTIFICATION_CREATED,
        InvestorIngestEventTypes.BALANCE_UPDATED,
        InvestorBffEventTypes.ONBOARDING_COMPLETED,
        InvestorBffEventTypes.GO_LIVE_CONFIRMED,
      ],
    });

    // --- Ingress 2: Broadcast events → broadcast-listener.ts ---
    const broadcastIngress = new Ingress(this, 'BroadcastIngress', {
      state,
      entry: join(__dirname, 'handlers', 'broadcast-listener.ts'),
      eventTypes: [
        InvestorBffEventTypes.BROKER_CIRCUIT_OPEN,
        InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED,
        InvestorIngestEventTypes.DEPOSIT_DETECTED,
      ],
      environment: facade.graphqlUrl ? { APPSYNC_URL: facade.graphqlUrl } : {},
    });

    // Grant BroadcastIngress handler permission to invoke AppSync mutations via IAM
    if (facade.api) {
      broadcastIngress.handler.addToRolePolicy(new PolicyStatement({
        actions: ['appsync:GraphQL'],
        resources: [`${facade.api.arn}/*`],
      }));
    }

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'InvestorProfile': {
          insert: InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
          modify: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
        },
        'MandateStatus': {
          insert: InvestorBffEventTypes.MANDATE_ISSUED,
          modify: InvestorBffEventTypes.MANDATE_REVOKED,
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

    new MfeBucket(this, 'MfeBucket', { mfeKey: 'investor' });

    this.addObservability({ ingress, egress });
  }
}
