import { EventBus } from 'aws-cdk-lib/aws-events';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, ManagedNodejsFunction } from '@nestfolio/cdk-constructs/core';
import { LedgerCtrlEventTypes } from './domain/events';
import { getDomainAccounts, resolveBusArn } from '@nestfolio/cdk-constructs/extensions';
import { LedgerIngestEventTypes } from '@nestfolio/ledger-adpt/domain';
import { reducerProps } from '@nestfolio/cdk-constructs/utils';

export class LedgerCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const domainAccounts = getDomainAccounts(this);
    const ledgerBusArn = resolveBusArn(this, 'LedgerBus', this.prefix, 'ledger', domainAccounts);
    this.eventBus = EventBus.fromEventBusArn(this, 'LedgerBus', ledgerBusArn);

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        LedgerIngestEventTypes.ORDER_FILLED,
        LedgerIngestEventTypes.ORDER_PARTIALLY_FILLED,
        LedgerIngestEventTypes.ORDER_REJECTED,
        LedgerIngestEventTypes.ORDER_CANCELLED,
        LedgerIngestEventTypes.DEPOSIT_SETTLED,
        LedgerIngestEventTypes.WITHDRAWAL_SETTLED,
        LedgerIngestEventTypes.CORPORATE_ACTION_APPLIED,
        LedgerIngestEventTypes.DECISION_PACKET_CREATED,
      ],
    });

    // Reducer: DDB Stream consumer that materializes account snapshots.
    // Shape comes from reducerProps (512 MB, 60s, batch 100, window 5s, parallelization 1).
    const reducerFn = new ManagedNodejsFunction(this, 'ReducerFn', {
      ...reducerProps.lambdaProps,
      entry: join(__dirname, 'handlers', 'reducer.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
        SERVICE_NAME: 'ledger-ctrl',
        SNAPSHOT_HISTORY_TTL_DAYS: '365',
      },
    });
    state.getTable().grantReadWriteData(reducerFn);

    reducerFn.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      batchSize: reducerProps.ddbStreamBatchSize,
      maxBatchingWindow: reducerProps.ddbStreamMaxBatchingWindow,
      parallelizationFactor: reducerProps.ddbStreamParallelizationFactor,
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

    // Snapshot Publisher: DDB Stream consumer that writes derived events
    // (BalanceEvent, PortfolioEvent, LedgerEntryEvent, SnapshotHistory)
    // from AccountSnapshot INSERT/MODIFY events.
    const snapshotPublisherFn = new ManagedNodejsFunction(this, 'SnapshotPublisherFn', {
      ...reducerProps.lambdaProps,
      entry: join(__dirname, 'handlers', 'snapshot-publisher.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
        SERVICE_NAME: 'ledger-ctrl',
      },
    });
    state.getTable().grantReadWriteData(snapshotPublisherFn);

    snapshotPublisherFn.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      batchSize: reducerProps.ddbStreamBatchSize,
      maxBatchingWindow: reducerProps.ddbStreamMaxBatchingWindow,
      parallelizationFactor: reducerProps.ddbStreamParallelizationFactor,
      filters: [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual('AccountSnapshot') },
            },
          },
        }),
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('MODIFY'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual('AccountSnapshot') },
            },
          },
        }),
      ],
    }));

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'BalanceEvent': {
          insert: LedgerCtrlEventTypes.BALANCE_UPDATED,
          modify: LedgerCtrlEventTypes.BALANCE_EVENT_UPDATED,
        },
        'PortfolioEvent': {
          insert: LedgerCtrlEventTypes.PORTFOLIO_UPDATED,
          modify: LedgerCtrlEventTypes.PORTFOLIO_EVENT_UPDATED,
        },
        'LedgerEntryEvent': {
          insert: LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED,
          modify: LedgerCtrlEventTypes.LEDGER_ENTRY_EVENT_UPDATED,
        },
      },
    });

    this.addObservability({ ingress, egress, extraLambdas: [reducerFn, snapshotPublisherFn] });
  }
}
