import { join } from 'path';
import { Duration, SecretValue, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CircuitBreakerHealDefinition, Egress, Ingress, ManagedNodejsFunction, Orchestration, ServiceStack, ServiceStackProps, State } from '@nestfolio/cdk-constructs/core';
import { adapterProps, defaultLambdaProps, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
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
      profile: adapterProps,
      environment: {
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
        NESTFOLIO_PREFIX: props.prefix,
      },
    });

    // IAM: SSM + Secrets Manager for ParamsAndSecrets Extension
    const ssmSecretsPolicy = [
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/*`],
      }),
      new PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${Stack.of(this).region}:${Stack.of(this).account}:secret:${props.prefix}-broker-alpaca-adpt/alpaca-api-keys*`],
      }),
    ];
    ssmSecretsPolicy.forEach(p => ingress.handler.addToRolePolicy(p));

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'AlpacaOrderResult': {
          insert: { field: 'status', map: {
            PLACED: AlpacaAdptEventTypes.ALPACA_ORDER_PLACED,
            FILLED: AlpacaAdptEventTypes.ALPACA_ORDER_FILLED,
            PARTIALLY_FILLED: AlpacaAdptEventTypes.ALPACA_ORDER_PARTIALLY_FILLED,
            REJECTED: AlpacaAdptEventTypes.ALPACA_ORDER_REJECTED,
            CANCELLED: AlpacaAdptEventTypes.ALPACA_ORDER_CANCELLED,
            CANCEL_FAILED: AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_FAILED,
          }},
          modify: { field: 'status', map: {
            FILLED: AlpacaAdptEventTypes.ALPACA_ORDER_FILLED,
            PARTIALLY_FILLED: AlpacaAdptEventTypes.ALPACA_ORDER_PARTIALLY_FILLED,
            REJECTED: AlpacaAdptEventTypes.ALPACA_ORDER_REJECTED,
            CANCELLED: AlpacaAdptEventTypes.ALPACA_ORDER_CANCELLED,
          }},
        },
        'AlpacaTransferResult': {
          insert: { field: 'status', map: {
            INITIATED: AlpacaAdptEventTypes.ALPACA_TRANSFER_INITIATED,
            COMPLETED: AlpacaAdptEventTypes.ALPACA_TRANSFER_COMPLETED,
            FAILED: AlpacaAdptEventTypes.ALPACA_TRANSFER_FAILED,
          }},
          modify: { field: 'status', map: {
            COMPLETED: AlpacaAdptEventTypes.ALPACA_TRANSFER_COMPLETED,
            FAILED: AlpacaAdptEventTypes.ALPACA_TRANSFER_FAILED,
          }},
        },
        'AlpacaAccountSnapshot': { insert: AlpacaAdptEventTypes.ALPACA_ACCOUNT_SNAPSHOT },
        'NormalizedEvent': {
          insert: { field: 'sk', passthrough: true, emits: [
            AlpacaAdptEventTypes.BROKER_CIRCUIT_OPEN,
            AlpacaAdptEventTypes.BROKER_CIRCUIT_CLOSED,
            AlpacaAdptEventTypes.BROKER_HEAL_ESCALATED,
          ]},
        },
      },
    });

    // --- EventBridge Connection for Alpaca API auth (used by HealStateMachine HTTP:Invoke) ---
    const alpacaConnection = new events.Connection(this, 'AlpacaConnection', {
      authorization: events.Authorization.apiKey(
        'APCA-API-KEY-ID',
        SecretValue.secretsManager(
          `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
          { jsonField: 'apiKeyId' },
        ),
      ),
      headerParameters: {
        'APCA-API-SECRET-KEY': events.HttpParameter.fromSecret(
          SecretValue.secretsManager(
            `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
            { jsonField: 'apiKeySecret' },
          ),
        ),
      },
    });

    // Alpaca base URL (deploy-time resolution from SSM)
    const alpacaBaseUrl = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
    );

    // --- Circuit Breaker Heal Workflow ---
    const healWorkflow = new CircuitBreakerHealDefinition(this, 'HealWorkflow', {
      table: state.getTable(),
      breakerKey: 'CircuitBreaker#alpaca',
      events: {
        closed: AlpacaAdptEventTypes.BROKER_CIRCUIT_CLOSED,
        escalated: AlpacaAdptEventTypes.BROKER_HEAL_ESCALATED,
      },
      healthCheck: {
        connection: alpacaConnection,
        apiRoot: alpacaBaseUrl,
        apiEndpoint: sfn.TaskInput.fromText('/v2/account'),
        method: sfn.TaskInput.fromText('GET'),
        timeoutSeconds: 10,
      },
    });

    const healOrchestration = new Orchestration(this, 'HealStateMachine', {
      state,
      definitionBody: healWorkflow.definitionBody,
      triggers: [AlpacaAdptEventTypes.BROKER_CIRCUIT_OPEN],
      timeout: Duration.hours(2),
    });

    // --- Order Poll Handler Lambda (invoked by SF, not via Ingress) ---
    const orderPollFn = new ManagedNodejsFunction(this, 'OrderPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'order-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
        NESTFOLIO_PREFIX: props.prefix,
      },
      paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      timeout: Duration.seconds(30),
    });
    table.grantReadWriteData(orderPollFn);
    ssmSecretsPolicy.forEach(p => orderPollFn.addToRolePolicy(p));

    // --- Transfer Poll Handler Lambda (invoked by SF, not via Ingress) ---
    const transferPollFn = new ManagedNodejsFunction(this, 'TransferPollFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'transfer-poll-handler.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
        NESTFOLIO_PREFIX: props.prefix,
      },
      paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      timeout: Duration.seconds(30),
    });
    table.grantReadWriteData(transferPollFn);
    ssmSecretsPolicy.forEach(p => transferPollFn.addToRolePolicy(p));

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
      extraDlqs: [transferPolling.dlq, healOrchestration.dlq],
    });
  }
}
