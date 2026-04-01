import { join } from 'path';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Egress, Ingress, Orchestration, ServiceStack, ServiceStackProps, State } from '@nestfolio/cdk-constructs/core';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { AlpacaAdptEventTypes } from './domain/events';
import { OrderPollingDefinition } from './constructs/order-polling-definition';
import { TransferPollingDefinition } from './constructs/transfer-polling-definition';

export class BrokerAlpacaAdptStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');
    const table = state.getTable();

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED,
        AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'AlpacaOrderResult': {
          insert: { field: 'status', map: {
            PLACED: 'ALPACA_ORDER_PLACED',
            FILLED: 'ALPACA_ORDER_FILLED',
            PARTIALLY_FILLED: 'ALPACA_ORDER_PARTIALLY_FILLED',
            REJECTED: 'ALPACA_ORDER_REJECTED',
            CANCELLED: 'ALPACA_ORDER_CANCELLED',
            CANCEL_FAILED: 'ALPACA_ORDER_CANCEL_FAILED',
          }},
          modify: { field: 'status', map: {
            FILLED: 'ALPACA_ORDER_FILLED',
            PARTIALLY_FILLED: 'ALPACA_ORDER_PARTIALLY_FILLED',
            REJECTED: 'ALPACA_ORDER_REJECTED',
            CANCELLED: 'ALPACA_ORDER_CANCELLED',
          }},
        },
        'AlpacaTransferResult': {
          insert: { field: 'status', map: {
            INITIATED: 'ALPACA_TRANSFER_INITIATED',
            COMPLETED: 'ALPACA_TRANSFER_COMPLETED',
            FAILED: 'ALPACA_TRANSFER_FAILED',
          }},
          modify: { field: 'status', map: {
            COMPLETED: 'ALPACA_TRANSFER_COMPLETED',
            FAILED: 'ALPACA_TRANSFER_FAILED',
          }},
        },
        'AlpacaAccountSnapshot': { insert: 'ALPACA_ACCOUNT_SNAPSHOT' },
      },
    });

    // --- Order Poll Handler Lambda (invoked by SF, not via Ingress) ---
    const orderPollFn = new NodejsFunction(this, 'OrderPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'order-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
      },
      timeout: Duration.seconds(30),
    });
    table.grantReadWriteData(orderPollFn);

    // --- Transfer Poll Handler Lambda (invoked by SF, not via Ingress) ---
    const transferPollFn = new NodejsFunction(this, 'TransferPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'transfer-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
      },
      timeout: Duration.seconds(30),
    });
    table.grantReadWriteData(transferPollFn);

    // --- Order Polling Orchestration ---
    const orderPollingDef = new OrderPollingDefinition(this, 'OrderPollingDef', {
      pollHandlerFn: orderPollFn,
    });
    const orderPolling = new Orchestration(this, 'OrderPollingStateMachine', {
      state,
      definitionBody: orderPollingDef.definitionBody,
      triggers: [AlpacaAdptEventTypes.ALPACA_ORDER_PLACED],
      timeout: Duration.hours(24),
    });
    orderPollFn.grantInvoke(orderPolling.stateMachine);

    // --- Transfer Polling Orchestration ---
    const transferPollingDef = new TransferPollingDefinition(this, 'TransferPollingDef', {
      pollHandlerFn: transferPollFn,
    });
    const transferPolling = new Orchestration(this, 'TransferPollingStateMachine', {
      state,
      definitionBody: transferPollingDef.definitionBody,
      triggers: [AlpacaAdptEventTypes.ALPACA_TRANSFER_INITIATED],
      timeout: Duration.days(7),
    });
    transferPollFn.grantInvoke(transferPolling.stateMachine);

    // --- Observability ---
    this.addObservability({
      ingress,
      egress,
      orchestration: orderPolling,
      extraLambdas: [orderPollFn, transferPollFn],
      extraDlqs: [transferPolling.dlq],
    });
  }
}
