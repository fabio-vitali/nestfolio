import { join } from 'path';
import { Construct } from 'constructs';
import { Rule } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { BrokerCtrlInboundEventTypes, BrokerCtrlEventTypes } from './domain/events';
import { OrderStateMachine } from './state-machine/order-state-machine';
import { CircuitBreakerHealStateMachine } from './state-machine/circuit-breaker-heal';

export class BrokerCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const table = this.state.getTable();

    // --- Egress: CDC for NormalizedEvent → canonical events ---
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['NormalizedEvent'],
    });

    // --- Ingress 1: ExecutionMode cache listener ---
    const modeIngress = new Ingress(this, 'ModeIngress', {
      eventTypes: [BrokerCtrlInboundEventTypes.EXECUTION_MODE_CHANGED],
      entry: join(__dirname, 'handlers', 'mode-listener.ts'),
    });

    // --- Ingress 2: CallbackResolver — adapter result events ---
    const CALLBACK_EVENT_TYPES = [
      // Sim adapter results
      BrokerCtrlInboundEventTypes.SIM_ORDER_FILLED,
      BrokerCtrlInboundEventTypes.SIM_ORDER_REJECTED,
      // Alpaca adapter results (ALPACA_ORDER_PLACED intentionally excluded —
      // it is an intermediate ack, not a terminal state)
      BrokerCtrlInboundEventTypes.ALPACA_ORDER_FILLED,
      BrokerCtrlInboundEventTypes.ALPACA_ORDER_PARTIALLY_FILLED,
      BrokerCtrlInboundEventTypes.ALPACA_ORDER_REJECTED,
      BrokerCtrlInboundEventTypes.ALPACA_ORDER_CANCELLED,
      BrokerCtrlInboundEventTypes.ALPACA_ORDER_CANCEL_FAILED,
      BrokerCtrlInboundEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
    ];

    const callbackIngress = new Ingress(this, 'CallbackIngress', {
      eventTypes: CALLBACK_EVENT_TYPES,
      entry: join(__dirname, 'handlers', 'callback-resolver.ts'),
    });

    // --- RouteOrder Lambda — invoked by Step Functions, not via Ingress ---
    const routeOrderFn = new NodejsFunction(this, 'RouteOrderFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'route-order.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        BUS_NAME: this.eventBus.eventBusName,
      },
    });
    table.grantReadWriteData(routeOrderFn);
    this.eventBus.grantPutEventsTo(routeOrderFn);

    // --- Step Functions state machine ---
    const orderStateMachine = new OrderStateMachine(this, 'OrderStateMachine', {
      eventBus: this.eventBus,
      table,
      routeOrderFn,
    });

    // Grant CallbackResolver permission to SendTaskSuccess/SendTaskFailure
    callbackIngress.handler.addEnvironment(
      'STATE_MACHINE_ARN',
      orderStateMachine.stateMachine.stateMachineArn,
    );
    orderStateMachine.stateMachine.grantTaskResponse(callbackIngress.handler);

    // --- EventBridge rule: ORDER_SUBMITTED → start SF execution ---
    new Rule(this, 'OrderSubmittedTrigger', {
      eventBus: this.eventBus,
      eventPattern: {
        detailType: [BrokerCtrlInboundEventTypes.ORDER_SUBMITTED],
      },
      targets: [
        new SfnStateMachine(orderStateMachine.stateMachine, {
          input: RuleTargetInput.fromEventPath('$.detail'),
        }),
      ],
    });

    // --- EmitHealthCheck Lambda — invoked by heal SF, not via Ingress ---
    const emitHealthCheckFn = new NodejsFunction(this, 'EmitHealthCheckFn', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'emit-health-check.ts'),
      environment: {
        TABLE_NAME: table.tableName,
        BUS_NAME: this.eventBus.eventBusName,
      },
    });
    table.grantReadWriteData(emitHealthCheckFn);
    this.eventBus.grantPutEventsTo(emitHealthCheckFn);

    // --- Circuit breaker heal state machine ---
    const healStateMachine = new CircuitBreakerHealStateMachine(this, 'HealStateMachine', {
      eventBus: this.eventBus,
      table,
      emitHealthCheckFn,
    });

    // Grant CallbackResolver permission to respond to heal SF task tokens
    callbackIngress.handler.addEnvironment(
      'HEAL_STATE_MACHINE_ARN',
      healStateMachine.stateMachine.stateMachineArn,
    );
    healStateMachine.stateMachine.grantTaskResponse(callbackIngress.handler);

    // --- EventBridge rule: BROKER_CIRCUIT_OPEN → start heal SF execution ---
    new Rule(this, 'BreakerOpenTrigger', {
      eventBus: this.eventBus,
      eventPattern: {
        detailType: [BrokerCtrlEventTypes.BROKER_CIRCUIT_OPEN],
      },
      targets: [
        new SfnStateMachine(healStateMachine.stateMachine, {
          input: RuleTargetInput.fromEventPath('$.detail'),
        }),
      ],
    });

    // --- Ingress 3: Deposit/Withdrawal routing ---
    const depositWithdrawalIngress = new Ingress(this, 'DepositWithdrawalIngress', {
      eventTypes: [
        BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED,
        BrokerCtrlInboundEventTypes.WITHDRAWAL_REQUESTED,
      ],
      entry: join(__dirname, 'handlers', 'deposit-withdrawal-router.ts'),
    });

    // --- Ingress 4: Deposit/Withdrawal normalizer — writes NormalizedEvent for CDC ---
    const depositWithdrawalNormalizerIngress = new Ingress(this, 'DepositWithdrawalNormalizerIngress', {
      eventTypes: [
        BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED,
        BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED,
        BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED,
        BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED,
      ],
      entry: join(__dirname, 'handlers', 'deposit-withdrawal-normalizer.ts'),
    });

    // --- Observability ---
    this.addObservability({
      ingress: modeIngress,
      egress,
      extraLambdas: [
        callbackIngress.handler,
        routeOrderFn,
        emitHealthCheckFn,
        depositWithdrawalIngress.handler,
        depositWithdrawalNormalizerIngress.handler,
      ],
      extraDlqs: [
        callbackIngress.dlq,
        depositWithdrawalIngress.dlq,
        depositWithdrawalNormalizerIngress.dlq,
      ],
    });
  }
}
