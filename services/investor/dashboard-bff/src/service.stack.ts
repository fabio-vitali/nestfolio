import { join } from 'path';
import { Construct } from 'constructs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { ServiceStack, ServiceStackProps, State, Ingress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
import { MfeBucket } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

export class DashboardBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const facade = new Facade(this, 'Facade', {
      state,
      enableIamAuth: true,
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['publishDashboardUpdate'],
      }),
    });

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        InvestorIngestEventTypes.BALANCE_UPDATED,
        InvestorIngestEventTypes.PORTFOLIO_UPDATED,
        InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
        InvestorIngestEventTypes.DECISION_PACKET_CREATED,
        InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED,
        InvestorIngestEventTypes.DECISION_APPROVED,
        InvestorIngestEventTypes.DECISION_BLOCKED,
        InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
        InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
        InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
        InvestorIngestEventTypes.DEPOSIT_DETECTED,
        InvestorIngestEventTypes.WITHDRAWAL_COMPLETED,
      ],
    });

    // DDB-stream-driven publisher: fans every AdvisoryStatus row mutation out
    // to clients via @aws_subscribe(mutations: ["publishDashboardUpdate"]).
    // Keeps the materialize pipeline declarative; subscription publication is
    // a post-commit side effect, no race with the engine's write.
    const publisher = new NodejsFunction(this, 'DashboardPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'dashboard-publisher.ts'),
      environment: facade.graphqlUrl ? { APPSYNC_URL: facade.graphqlUrl } : {},
    });
    publisher.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        retryAttempts: 3,
      }),
    );
    if (facade.api) {
      publisher.addToRolePolicy(new PolicyStatement({
        actions: ['appsync:GraphQL'],
        resources: [`${facade.api.arn}/*`],
      }));
    }

    new MfeBucket(this, 'MfeBucket', { mfeKey: 'dashboard' });

    this.addObservability({ ingress });
  }
}
