import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

export interface OrderWorkflowDefinitionProps {
  readonly eventBus: IEventBus;
  readonly table: ITable;
  readonly routeOrderFn: IFunction;
}

/**
 * Step Functions workflow definition for the order routing and lifecycle.
 * Builds the state machine chain but does NOT create the StateMachine resource.
 * Use with the Orchestration construct which manages the StateMachine, triggers, and DLQ.
 *
 * Flow:
 * 1. ReadExecutionMode (DDB GetItem)
 * 2. RouteOrder (Lambda invoke.waitForTaskToken)
 * 3. ClassifyResult (Choice on adapter callback)
 *    - FILLED -> MarkFilled (Parallel DDB writes) -> End
 *    - PARTIALLY_FILLED -> MarkPartialFill -> WaitForMoreFills -> ClassifyResult
 *    - default -> MarkRejected -> End
 * 4. HandleTimeout -> escalate order + NormalizedEvent -> End
 */
export class OrderWorkflowDefinition extends Construct {
  readonly definitionBody: sfn.DefinitionBody;

  constructor(scope: Construct, id: string, props: OrderWorkflowDefinitionProps) {
    super(scope, id);

    const { table, routeOrderFn } = props;
    const tableName = table.tableName;

    // ---------------------------------------------------------------
    // 1. ReadExecutionMode — DDB GetItem (direct)
    // ---------------------------------------------------------------
    const readExecutionMode = new sfn.CustomState(this, 'ReadExecutionMode', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:getItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { 'S.$': "States.Format('ExecutionMode#{}', $.tenantId)" },
            sk: { S: 'ExecutionMode' },
          },
        },
        ResultPath: '$.executionMode',
      },
    });

    // ---------------------------------------------------------------
    // 2. RouteOrder — Lambda invoke.waitForTaskToken
    // ---------------------------------------------------------------
    const routeOrder = new sfn.CustomState(this, 'RouteOrder', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke.waitForTaskToken',
        Parameters: {
          FunctionName: routeOrderFn.functionArn,
          Payload: {
            'order.$': '$',
            'executionMode.$': '$.executionMode.Item.mode.S',
            'taskToken.$': '$$.Task.Token',
          },
        },
        TimeoutSeconds: 300,
        ResultPath: '$.adapterResult',
      },
    });

    // ---------------------------------------------------------------
    // 3. ClassifyResult — Choice on adapter result
    // ---------------------------------------------------------------
    const classifyResult = new sfn.Choice(this, 'ClassifyResult');

    // ---------------------------------------------------------------
    // 4. MarkFilled — Parallel: UpdateItem (FILLED) + PutItem (NormalizedEvent ORDER_FILLED)
    // ---------------------------------------------------------------
    const markFilledUpdateOrder = new sfn.CustomState(this, 'MarkFilledUpdateOrder', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { 'S.$': "States.Format('BrokerOrder#{}#{}', $.tenantId, $.orderId)" },
            sk: { S: 'BrokerOrder' },
          },
          UpdateExpression: 'SET #st = :st, filledQty = :fq, averageFillPrice = :ap, filledAt = :fa',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: {
            ':st': { S: 'FILLED' },
            ':fq': { 'N.$': "States.Format('{}', $.adapterResult.filledQty)" },
            ':ap': { 'N.$': "States.Format('{}', $.adapterResult.averageFillPrice)" },
            ':fa': { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const markFilledNormalizedEvent = new sfn.CustomState(this, 'MarkFilledNormalizedEvent', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Parameters: {
          TableName: tableName,
          Item: {
            pk: { 'S.$': "States.Format('NormalizedEvent#{}#{}', $.tenantId, $.orderId)" },
            sk: { 'S.$': "States.Format('ORDER_FILLED#{}', $$.State.EnteredTime)" },
            __typename: { S: 'NormalizedEvent' },
            tenantId: { 'S.$': '$.tenantId' },
            orderId: { 'S.$': '$.orderId' },
            executionMode: { 'S.$': '$.executionMode.Item.mode.S' },
            filledQty: { 'N.$': "States.Format('{}', $.adapterResult.filledQty)" },
            averageFillPrice: { 'N.$': "States.Format('{}', $.adapterResult.averageFillPrice)" },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const markFilled = new sfn.Parallel(this, 'MarkFilled', {
      resultPath: sfn.JsonPath.DISCARD,
    });
    markFilled.branch(markFilledUpdateOrder);
    markFilled.branch(markFilledNormalizedEvent);

    const endFilled = new sfn.Succeed(this, 'EndFilled');

    // ---------------------------------------------------------------
    // 5. MarkPartialFill — DDB UpdateItem, then WaitForMoreFills
    // ---------------------------------------------------------------
    const markPartialFill = new sfn.CustomState(this, 'MarkPartialFill', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { 'S.$': "States.Format('BrokerOrder#{}#{}', $.tenantId, $.orderId)" },
            sk: { S: 'BrokerOrder' },
          },
          UpdateExpression: 'SET #st = :st, filledQty = :fq, averageFillPrice = :ap',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: {
            ':st': { S: 'PARTIALLY_FILLED' },
            ':fq': { 'N.$': "States.Format('{}', $.adapterResult.filledQty)" },
            ':ap': { 'N.$': "States.Format('{}', $.adapterResult.averageFillPrice)" },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    // WaitForMoreFills — re-invoke RouteOrder to store new taskToken and re-emit
    const waitForMoreFills = new sfn.CustomState(this, 'WaitForMoreFills', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke.waitForTaskToken',
        Parameters: {
          FunctionName: routeOrderFn.functionArn,
          Payload: {
            'order.$': '$',
            'executionMode.$': '$.executionMode.Item.mode.S',
            'taskToken.$': '$$.Task.Token',
          },
        },
        TimeoutSeconds: Duration.minutes(15).toSeconds(),
        ResultPath: '$.adapterResult',
      },
    });

    // ---------------------------------------------------------------
    // 6. MarkRejected — Parallel: UpdateItem (REJECTED) + PutItem (NormalizedEvent ORDER_REJECTED)
    // ---------------------------------------------------------------
    const markRejectedUpdateOrder = new sfn.CustomState(this, 'MarkRejectedUpdateOrder', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { 'S.$': "States.Format('BrokerOrder#{}#{}', $.tenantId, $.orderId)" },
            sk: { S: 'BrokerOrder' },
          },
          UpdateExpression: 'SET #st = :st, failureReason = :fr',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: {
            ':st': { S: 'REJECTED' },
            ':fr': { 'S.$': '$.adapterResult.reason' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const markRejectedNormalizedEvent = new sfn.CustomState(this, 'MarkRejectedNormalizedEvent', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Parameters: {
          TableName: tableName,
          Item: {
            pk: { 'S.$': "States.Format('NormalizedEvent#{}#{}', $.tenantId, $.orderId)" },
            sk: { 'S.$': "States.Format('ORDER_REJECTED#{}', $$.State.EnteredTime)" },
            __typename: { S: 'NormalizedEvent' },
            tenantId: { 'S.$': '$.tenantId' },
            orderId: { 'S.$': '$.orderId' },
            executionMode: { 'S.$': '$.executionMode.Item.mode.S' },
            failureReason: { 'S.$': '$.adapterResult.reason' },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const markRejected = new sfn.Parallel(this, 'MarkRejected', {
      resultPath: sfn.JsonPath.DISCARD,
    });
    markRejected.branch(markRejectedUpdateOrder);
    markRejected.branch(markRejectedNormalizedEvent);

    const endRejected = new sfn.Succeed(this, 'EndRejected');

    // ---------------------------------------------------------------
    // 7. HandleTimeout — Parallel: escalate order + write NormalizedEvent
    //
    // Implemented as CustomState with inline ASL Parallel branches.
    // Connected to the graph via .addCatch() on RouteOrder and WaitForMoreFills.
    // ---------------------------------------------------------------
    const handleTimeout = new sfn.CustomState(this, 'HandleTimeout', {
      stateJson: {
        Type: 'Parallel',
        ResultPath: null,
        Branches: [
          {
            StartAt: 'HandleTimeoutEscalateOrder',
            States: {
              HandleTimeoutEscalateOrder: {
                Type: 'Task',
                Resource: 'arn:aws:states:::dynamodb:updateItem',
                Parameters: {
                  TableName: tableName,
                  Key: {
                    pk: { 'S.$': "States.Format('BrokerOrder#{}#{}', $.tenantId, $.orderId)" },
                    sk: { S: 'BrokerOrder' },
                  },
                  UpdateExpression: 'SET #st = :st',
                  ExpressionAttributeNames: { '#st': 'state' },
                  ExpressionAttributeValues: {
                    ':st': { S: 'ESCALATED' },
                  },
                },
                ResultPath: null,
                End: true,
              },
            },
          },
          {
            StartAt: 'HandleTimeoutNormalizedEvent',
            States: {
              HandleTimeoutNormalizedEvent: {
                Type: 'Task',
                Resource: 'arn:aws:states:::dynamodb:putItem',
                Parameters: {
                  TableName: tableName,
                  Item: {
                    pk: { 'S.$': "States.Format('NormalizedEvent#{}#{}', $.tenantId, $.orderId)" },
                    sk: { 'S.$': "States.Format('ORDER_ESCALATED#{}', $$.State.EnteredTime)" },
                    __typename: { S: 'NormalizedEvent' },
                    tenantId: { 'S.$': '$.tenantId' },
                    orderId: { 'S.$': '$.orderId' },
                    executionMode: { 'S.$': '$.executionMode.Item.mode.S' },
                    failureReason: { S: 'Adapter timeout — escalated' },
                    timestamp: { 'S.$': '$$.State.EnteredTime' },
                  },
                },
                ResultPath: null,
                End: true,
              },
            },
          },
        ],
      },
    });

    const endEscalated = new sfn.Succeed(this, 'EndEscalated');

    // ===============================================================
    // Wire the chain
    // ===============================================================

    // Partial fill → wait for more fills → classify
    markPartialFill.next(waitForMoreFills);

    // Terminal states for parallel branches
    markFilled.next(endFilled);
    markRejected.next(endRejected);
    handleTimeout.next(endEscalated);

    // CDK addCatch registers HandleTimeout in the state graph (raw JSON Catch is opaque to CDK)
    routeOrder.addCatch(handleTimeout, { errors: ['States.Timeout'], resultPath: '$.error' });
    waitForMoreFills.addCatch(handleTimeout, { errors: ['States.Timeout'], resultPath: '$.error' });

    // ClassifyResult choice — FILLED, PARTIALLY_FILLED, or rejected (default)
    classifyResult
      .when(sfn.Condition.stringEquals('$.adapterResult.status', 'FILLED'), markFilled)
      .when(sfn.Condition.stringEquals('$.adapterResult.status', 'PARTIALLY_FILLED'), markPartialFill)
      .otherwise(markRejected);

    // Main chain: ReadExecutionMode → RouteOrder
    const definition = readExecutionMode.next(routeOrder);

    // CDK merges .next() into stateJson as the happy-path Next field.
    // Catch→Next references (e.g. 'HandleTimeout') resolve via CDK construct IDs.
    routeOrder.next(classifyResult);
    waitForMoreFills.next(classifyResult);

    // ---------------------------------------------------------------
    // Definition Body — consumed by Orchestration construct
    // ---------------------------------------------------------------
    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
  }
}
