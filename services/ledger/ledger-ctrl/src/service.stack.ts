import { Duration } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, Ingress, Egress, defaultLambdaProps, getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs';

export class LedgerCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const domainAccounts = getDomainAccounts(this);
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', this.prefix, 'ledger', domainAccounts);
    this.eventBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'ORDER_FILLED',
        'ORDER_PARTIALLY_FILLED',
        'ORDER_REJECTED',
        'ORDER_CANCELLED',
        'DEPOSIT_DETECTED',
        'WITHDRAWAL_COMPLETED',
        'CORPORATE_ACTION_PROCESSED',
        'DECISION_PACKET_CREATED',
      ],
    });

    // Reducer: DDB Stream consumer that materializes account snapshots
    const reducerFn = new NodejsFunction(this, 'ReducerFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'reducer.ts'),
      environment: {
        TABLE_NAME: this.state.getTable().tableName,
        SERVICE_NAME: 'ledger-ctrl',
      },
    });
    this.state.getTable().grantReadWriteData(reducerFn);

    reducerFn.addEventSource(new DynamoEventSource(this.state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      batchSize: 100,
      maxBatchingWindow: Duration.seconds(5),
      filters: [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual('LedgerEntry') },
            },
          },
        }),
      ],
    }));

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['BalanceEvent', 'PortfolioEvent', 'LedgerEntryEvent'],
    });

    this.addObservability({ ingress, egress, extraLambdas: [reducerFn] });
  }
}
