import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { join } from 'path';
import {
  State,
  Ingress,
  Egress,
  Monitoring,
  ServiceDashboard,
  createNamingService,
  defaultLambdaProps,
  applyStandardTags,
} from '@nestfolio/cdk-constructs';

export class LedgerCtrlStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'ledger',
      service: 'ledger-ctrl',
    });

    const prefix = this.node.tryGetContext('prefix');
    if (!prefix) throw new Error('CDK context "prefix" is required. Pass -c prefix=dev|staging|prod');
    applyStandardTags(this, { service: 'ledger-ctrl', domain: 'ledger', environment: prefix });

    // State: DynamoDB table
    const state = new State(this, 'State');

    // Look up ledger-hub bus ARN from SSM
    const ledgerBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-ledger/event-hub/busArn`,
    );
    const ledgerBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    // Ingress: All events from ledger-hub bus
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: ledgerBus,
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
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      serviceName: 'ledger-ctrl',
      state,
    });

    // Reducer: DDB Stream consumer that materializes account snapshots
    const reducerFn = new NodejsFunction(this, 'ReducerFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'reducer.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
        SERVICE_NAME: 'ledger-ctrl',
      },
    });
    state.getTable().grantReadWriteData(reducerFn);

    // DDB Stream event source: filtered to LedgerEntry __typename only
    reducerFn.addEventSource(new DynamoEventSource(state.getTable(), {
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

    // Egress: publishes BalanceEvent, PortfolioEvent, LedgerEntryEvent to EventBridge
    const egress = new Egress(this, 'Egress', {
      table: state.getTable(),
      busName: ledgerBus.eventBusName,
      serviceName: 'ledger-ctrl',
      publishableTypes: ['BalanceEvent', 'PortfolioEvent', 'LedgerEntryEvent'],
      customEventTypeMap: {
        'BalanceEvent:INSERT': 'BALANCE_UPDATED',
        'PortfolioEvent:INSERT': 'PORTFOLIO_UPDATED',
        'LedgerEntryEvent:INSERT': 'LEDGER_ENTRY_RECORDED',
      },
    });

    // Monitoring: CloudWatch alarms for Lambda errors, DLQ depth
    new Monitoring(this, 'Monitoring', {
      lambdaFunctions: [ingress.handler, reducerFn],
      dlqs: [ingress.dlq, egress.dlq],
    });

    // Dashboard: CloudWatch dashboard for service observability
    new ServiceDashboard(this, 'Dashboard', {
      serviceName: 'ledger-ctrl',
      lambdaFunctions: [ingress.handler, reducerFn],
      dlqs: [ingress.dlq, egress.dlq],
    });
  }
}
