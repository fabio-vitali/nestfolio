import { join } from 'path';
import { Construct } from 'constructs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
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
        noneDataSource: ['requestAccountClosure', 'publishDepositUpdate', 'publishWithdrawalUpdate'],
        preSteps: {
          initiateDeposit: ['check-feature-flag.fn.js'],
          requestWithdrawal: ['check-feature-flag.fn.js'],
        },
        extraSteps: {
          getProfile: ['get-profile-mandate.fn.js'],
          updateOperatingMode: ['get-profile.fn.js'],
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
        // funding lifecycle from broker-ctrl, forwarded by investor-adpt → Deposit/WithdrawalRequest P1 rows
        InvestorIngestEventTypes.DEPOSIT_REQUESTED,
        InvestorIngestEventTypes.DEPOSIT_DETECTED,
        InvestorIngestEventTypes.DEPOSIT_SETTLED,
        InvestorIngestEventTypes.DEPOSIT_FAILED,
        InvestorIngestEventTypes.WITHDRAWAL_REQUESTED,
        InvestorIngestEventTypes.WITHDRAWAL_SETTLED,
        InvestorIngestEventTypes.WITHDRAWAL_FAILED,
      ],
    });

    // --- Ingress 2: Broadcast events → broadcast-listener.ts ---
    const broadcastIngress = new Ingress(this, 'BroadcastIngress', {
      state,
      entry: join(__dirname, 'handlers', 'broadcast-listener.ts'),
      eventTypes: [
        InvestorBffEventTypes.BROKER_CIRCUIT_OPEN,
        InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED,
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
          modify: {
            always: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
            onFieldChange: {
              goal: InvestorBffEventTypes.GOAL_UPDATED,
            },
          },
        },
        'Mandate': {
          insert: InvestorBffEventTypes.MANDATE_ISSUED,
          modify: {
            onFieldChange: {
              status: InvestorBffEventTypes.MANDATE_REVOKED,
              operatingMode: InvestorBffEventTypes.OPERATING_MODE_CHANGED,
            },
          },
        },
        // Intent outbox rows — CDC emits the *_INITIATED events. The projected
        // Deposit/WithdrawalRequest read-model rows are written by the funding
        // lifecycle transforms (single-writer), never CDC'd back out.
        'DepositIntent': {
          insert: InvestorBffEventTypes.DEPOSIT_INITIATED,
        },
        'WithdrawalIntent': {
          insert: InvestorBffEventTypes.WITHDRAWAL_INITIATED,
        },
        'ExecutionModeChange': {
          insert: InvestorBffEventTypes.EXECUTION_MODE_CHANGED,
          modify: InvestorBffEventTypes.EXECUTION_MODE_CHANGE_UPDATED,
        },
        'Notification': { modify: InvestorBffEventTypes.NOTIFICATION_READ },
      },
    });

    // DDB-stream-driven funding publisher: fans Deposit / WithdrawalRequest P1 row
    // status transitions out to clients via @aws_subscribe (onDepositUpdate /
    // onWithdrawalUpdate). The projectVersioned write (deposit/withdrawal-lifecycle
    // transforms) is unchanged; this is a post-commit side effect off the stream —
    // no race with the engine's write. SECOND stream consumer on this table (Egress
    // CDC is the first); DynamoDB allows up to 2 readers per shard.
    const depositPublisher = new NodejsFunction(this, 'DepositPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'deposit-publisher.ts'),
      environment: facade.graphqlUrl ? { APPSYNC_URL: facade.graphqlUrl } : {},
    });
    depositPublisher.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        retryAttempts: 3,
      }),
    );
    if (facade.api) {
      depositPublisher.addToRolePolicy(new PolicyStatement({
        actions: ['appsync:GraphQL'],
        resources: [`${facade.api.arn}/*`],
      }));
    }

    new MfeBucket(this, 'MfeBucket', { mfeKey: 'investor' });

    this.addObservability({ ingress, egress });
  }
}
