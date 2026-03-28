import { join } from 'path';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Orchestration } from '@nestfolio/cdk-constructs/core';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { BrokerCtrlInboundEventTypes, BrokerCtrlEventTypes } from './domain/events';
import { OrderWorkflowDefinition } from './state-machine/order-state-machine';
import { HealWorkflowDefinition } from './state-machine/circuit-breaker-heal';

export class BrokerCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');
    const table = state.getTable();

    // --- Egress: CDC for NormalizedEvent → canonical events ---
    const egress = new Egress(this, 'Egress', {
      state,
      publishableTypes: ['NormalizedEvent'],
    });

    // --- Ingress 1: ExecutionMode cache listener ---
    const modeIngress = new Ingress(this, 'ModeIngress', {
      state,
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
      state,
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

    // --- Order Orchestration ---
    const orderWorkflow = new OrderWorkflowDefinition(this, 'OrderWorkflow', {
      eventBus: this.eventBus,
      table,
      routeOrderFn,
    });
    const orderOrchestration = new Orchestration(this, 'OrderStateMachine', {
      state,
      definitionBody: orderWorkflow.definitionBody,
      triggers: [BrokerCtrlInboundEventTypes.ORDER_SUBMITTED],
      timeout: Duration.hours(1),
    });
    // Grant SF execution role permissions
    this.eventBus.grantPutEventsTo(orderOrchestration.stateMachine);
    routeOrderFn.grantInvoke(orderOrchestration.stateMachine);

    // --- Callback Ingress — grant SF task response ---
    orderOrchestration.grantCallbackAccess(callbackIngress.handler);

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

    // --- Heal Orchestration ---
    const healWorkflow = new HealWorkflowDefinition(this, 'HealWorkflow', {
      table,
      emitHealthCheckFn,
    });
    const healOrchestration = new Orchestration(this, 'HealStateMachine', {
      state,
      definitionBody: healWorkflow.definitionBody,
      triggers: [BrokerCtrlEventTypes.BROKER_CIRCUIT_OPEN],
      timeout: Duration.hours(2),
    });
    emitHealthCheckFn.grantInvoke(healOrchestration.stateMachine);
    healOrchestration.grantCallbackAccess(callbackIngress.handler, 'HEAL_STATE_MACHINE_ARN');

    // --- Ingress 3: Deposit/Withdrawal routing ---
    const depositWithdrawalIngress = new Ingress(this, 'DepositWithdrawalIngress', {
      state,
      eventTypes: [
        BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED,
        BrokerCtrlInboundEventTypes.WITHDRAWAL_REQUESTED,
      ],
      entry: join(__dirname, 'handlers', 'deposit-withdrawal-router.ts'),
    });

    // --- Ingress 4: Deposit/Withdrawal normalizer — writes NormalizedEvent for CDC ---
    const depositWithdrawalNormalizerIngress = new Ingress(this, 'DepositWithdrawalNormalizerIngress', {
      state,
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
      orchestration: orderOrchestration,
      extraLambdas: [
        callbackIngress.handler,
        routeOrderFn,
        emitHealthCheckFn,
        depositWithdrawalIngress.handler,
        depositWithdrawalNormalizerIngress.handler,
      ],
      extraDlqs: [
        callbackIngress.dlq,
        healOrchestration.dlq,
        depositWithdrawalIngress.dlq,
        depositWithdrawalNormalizerIngress.dlq,
      ],
    });
  }
}
