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
 * 2. ReadCircuitBreaker (DDB GetItem)
 * 3. IsCircuitBreakerOpen? Yes -> BreakerWait -> loop; No -> RouteOrder
 * 4. RouteOrder (Lambda invoke.waitForTaskToken)
 * 5. ClassifyResult (Choice on adapter callback)
 *    - FILLED -> MarkFilled (Parallel DDB writes) -> End
 *    - PARTIALLY_FILLED -> MarkPartialFill -> WaitForMoreFills -> ClassifyResult
 *    - transient failure -> CheckRetryCount -> retry loop or MarkFailed
 *    - default -> MarkRejected -> End
 * 6. HandleTimeout -> open breaker + escalate -> End
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
    // 2. ReadCircuitBreaker — DDB GetItem (direct)
    // ---------------------------------------------------------------
    const readCircuitBreaker = new sfn.CustomState(this, 'ReadCircuitBreaker', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:getItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { 'S.$': "States.Format('CircuitBreaker#{}#{}', $.tenantId, $.symbol)" },
            sk: { S: 'CircuitBreaker' },
          },
        },
        ResultPath: '$.circuitBreaker',
      },
    });

    // ---------------------------------------------------------------
    // 3. IsCircuitBreakerOpen — Choice
    // ---------------------------------------------------------------
    const isCircuitBreakerOpen = new sfn.Choice(this, 'IsCircuitBreakerOpen');

    // ---------------------------------------------------------------
    // 4. BreakerWait — Wait 30s, then re-read breaker
    // ---------------------------------------------------------------
    const breakerWait = new sfn.Wait(this, 'BreakerWait', {
      time: sfn.WaitTime.duration(Duration.seconds(30)),
    });

    // ---------------------------------------------------------------
    // 5. RouteOrder — Lambda invoke.waitForTaskToken
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
    // 6. ClassifyResult — Choice on adapter result
    // ---------------------------------------------------------------
    const classifyResult = new sfn.Choice(this, 'ClassifyResult');

    // ---------------------------------------------------------------
    // 7. MarkFilled — Parallel: UpdateItem (FILLED) + PutItem (NormalizedEvent ORDER_FILLED)
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
    // 8. MarkPartialFill — DDB UpdateItem, then WaitForMoreFills
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
    // 9. MarkRejected — Parallel: UpdateItem (REJECTED) + PutItem (NormalizedEvent ORDER_REJECTED)
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
    // 10. CheckRetryCount — Choice: retryCount < 3 → IncrementRetry, else → MarkFailed
    // ---------------------------------------------------------------
    const checkRetryCount = new sfn.Choice(this, 'CheckRetryCount');

    // ---------------------------------------------------------------
    // 11. IncrementRetry — DDB UpdateItem (increment retryCount)
    // ---------------------------------------------------------------
    const incrementRetry = new sfn.CustomState(this, 'IncrementRetry', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { 'S.$': "States.Format('BrokerOrder#{}#{}', $.tenantId, $.orderId)" },
            sk: { S: 'BrokerOrder' },
          },
          UpdateExpression: 'SET retryCount = retryCount + :inc',
          ExpressionAttributeValues: {
            ':inc': { N: '1' },
          },
          ReturnValues: 'ALL_NEW',
        },
        ResultSelector: {
          'retryCount.$': '$.Attributes.retryCount.N',
        },
        ResultPath: '$.retryState',
      },
    });

    // ---------------------------------------------------------------
    // 12. RetryBackoff — Choice on retryCount → Wait5s / Wait15s / Wait45s
    // ---------------------------------------------------------------
    const retryBackoff = new sfn.Choice(this, 'RetryBackoff');

    const wait5s = new sfn.Wait(this, 'Wait5s', {
      time: sfn.WaitTime.duration(Duration.seconds(5)),
    });

    const wait15s = new sfn.Wait(this, 'Wait15s', {
      time: sfn.WaitTime.duration(Duration.seconds(15)),
    });

    const wait45s = new sfn.Wait(this, 'Wait45s', {
      time: sfn.WaitTime.duration(Duration.seconds(45)),
    });

    // ---------------------------------------------------------------
    // 13. WaitForRetryResult — Lambda invoke.waitForTaskToken (re-invoke RouteOrder)
    // ---------------------------------------------------------------
    const waitForRetryResult = new sfn.CustomState(this, 'WaitForRetryResult', {
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
    // 14. MarkFailed — Parallel: UpdateItem (FAILED) + PutItem (NormalizedEvent ORDER_REJECTED)
    // ---------------------------------------------------------------
    const markFailedUpdateOrder = new sfn.CustomState(this, 'MarkFailedUpdateOrder', {
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
            ':st': { S: 'FAILED' },
            ':fr': { S: 'Max retries exceeded' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const markFailedNormalizedEvent = new sfn.CustomState(this, 'MarkFailedNormalizedEvent', {
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
            failureReason: { S: 'Max retries exceeded' },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const markFailed = new sfn.Parallel(this, 'MarkFailed', {
      resultPath: sfn.JsonPath.DISCARD,
    });
    markFailed.branch(markFailedUpdateOrder);
    markFailed.branch(markFailedNormalizedEvent);

    const endFailed = new sfn.Succeed(this, 'EndFailed');

    // ---------------------------------------------------------------
    // 15. HandleTimeout — Parallel: open breaker + escalate order + write NormalizedEvent
    //
    // Implemented as CustomState with inline ASL Parallel branches.
    // Connected to the graph via .addCatch() on RouteOrder, WaitForMoreFills, WaitForRetryResult.
    // ---------------------------------------------------------------
    const handleTimeout = new sfn.CustomState(this, 'HandleTimeout', {
      stateJson: {
        Type: 'Parallel',
        ResultPath: null,
        Branches: [
          {
            StartAt: 'HandleTimeoutOpenBreaker',
            States: {
              HandleTimeoutOpenBreaker: {
                Type: 'Task',
                Resource: 'arn:aws:states:::dynamodb:updateItem',
                Parameters: {
                  TableName: tableName,
                  Key: {
                    pk: { 'S.$': "States.Format('CircuitBreaker#{}#{}', $.tenantId, $.symbol)" },
                    sk: { S: 'CircuitBreaker' },
                  },
                  UpdateExpression: 'SET #st = :st, openedAt = :oa, reason = :r',
                  ExpressionAttributeNames: { '#st': 'state' },
                  ExpressionAttributeValues: {
                    ':st': { S: 'OPEN' },
                    ':oa': { 'S.$': '$$.State.EnteredTime' },
                    ':r': { S: 'Adapter timeout' },
                  },
                },
                ResultPath: null,
                End: true,
              },
            },
          },
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
          // 4th branch: Emit BROKER_CIRCUIT_OPEN NormalizedEvent for CDC → triggers heal SF
          {
            StartAt: 'HandleTimeoutCircuitBreakerEvent',
            States: {
              HandleTimeoutCircuitBreakerEvent: {
                Type: 'Task',
                Resource: 'arn:aws:states:::dynamodb:putItem',
                Parameters: {
                  TableName: tableName,
                  Item: {
                    pk: { 'S.$': "States.Format('NormalizedEvent#{}#CIRCUIT_BREAKER', $.tenantId)" },
                    sk: { 'S.$': "States.Format('BROKER_CIRCUIT_OPEN#{}', $$.State.EnteredTime)" },
                    __typename: { S: 'NormalizedEvent' },
                    tenantId: { 'S.$': '$.tenantId' },
                    symbol: { 'S.$': '$.symbol' },
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

    // Breaker wait loop
    breakerWait.next(readCircuitBreaker);

    // Circuit breaker check
    isCircuitBreakerOpen
      .when(sfn.Condition.stringEquals('$.circuitBreaker.Item.state.S', 'OPEN'), breakerWait)
      .otherwise(routeOrder);

    // Retry backoff → WaitForRetryResult
    wait5s.next(waitForRetryResult);
    wait15s.next(waitForRetryResult);
    wait45s.next(waitForRetryResult);

    retryBackoff
      .when(sfn.Condition.stringEquals('$.retryState.retryCount', '1'), wait5s)
      .when(sfn.Condition.stringEquals('$.retryState.retryCount', '2'), wait15s)
      .otherwise(wait45s);

    // Retry check
    checkRetryCount
      .when(sfn.Condition.numberLessThan('$.retryCount', 3), incrementRetry)
      .otherwise(markFailed.next(endFailed));

    // Increment retry → backoff
    incrementRetry.next(retryBackoff);

    // Partial fill → wait for more fills → classify
    markPartialFill.next(waitForMoreFills);

    // Terminal states for parallel branches
    markFilled.next(endFilled);
    markRejected.next(endRejected);
    handleTimeout.next(endEscalated);

    // CDK addCatch registers HandleTimeout in the state graph (raw JSON Catch is opaque to CDK)
    routeOrder.addCatch(handleTimeout, { errors: ['States.Timeout'], resultPath: '$.error' });
    waitForMoreFills.addCatch(handleTimeout, { errors: ['States.Timeout'], resultPath: '$.error' });
    waitForRetryResult.addCatch(handleTimeout, { errors: ['States.Timeout'], resultPath: '$.error' });

    // ClassifyResult choice
    classifyResult
      .when(sfn.Condition.stringEquals('$.adapterResult.status', 'FILLED'), markFilled)
      .when(sfn.Condition.stringEquals('$.adapterResult.status', 'PARTIALLY_FILLED'), markPartialFill)
      .when(sfn.Condition.stringEquals('$.adapterResult.failureClass', 'transient'), checkRetryCount)
      .otherwise(markRejected);

    // Main chain: ReadExecutionMode → ReadCircuitBreaker → IsCircuitBreakerOpen
    const definition = readExecutionMode
      .next(readCircuitBreaker)
      .next(isCircuitBreakerOpen);

    // CDK merges .next() into stateJson as the happy-path Next field.
    // Catch→Next references (e.g. 'HandleTimeout') resolve via CDK construct IDs.
    routeOrder.next(classifyResult);
    waitForMoreFills.next(classifyResult);
    waitForRetryResult.next(classifyResult);

    // ---------------------------------------------------------------
    // Definition Body — consumed by Orchestration construct
    // ---------------------------------------------------------------
    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
  }
}
