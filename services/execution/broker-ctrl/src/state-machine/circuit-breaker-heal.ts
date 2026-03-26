import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { IEventBus } from 'aws-cdk-lib/aws-events';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

export interface CircuitBreakerHealProps {
  readonly eventBus: IEventBus;
  readonly table: ITable;
  readonly emitHealthCheckFn: IFunction;
}

/**
 * Step Functions Standard Workflow that auto-heals an open circuit breaker.
 *
 * Triggered when a BROKER_CIRCUIT_OPEN NormalizedEvent is emitted via CDC.
 *
 * Flow:
 * 1. EmitHealthCheck — Lambda invoke.waitForTaskToken (stores healTaskToken + emits ALPACA_ACCOUNT_CHECK)
 * 2. On callback success (ALPACA_ACCOUNT_SNAPSHOT) → CloseBreaker (DDB UpdateItem) → End
 * 3. On timeout/failure → IncrementAttempt (Pass) → CheckAttemptLimit (Choice)
 *    - attempts < 10 → WaitForRetry (60s) → loop back to EmitHealthCheck
 *    - attempts >= 10 → EscalateHealFailure (terminal)
 */
export class CircuitBreakerHealStateMachine extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: CircuitBreakerHealProps) {
    super(scope, id);

    const { table, emitHealthCheckFn } = props;
    const tableName = table.tableName;

    // ---------------------------------------------------------------
    // 1. EmitHealthCheck — Lambda invoke.waitForTaskToken
    //    Invokes emit-health-check Lambda which stores healTaskToken
    //    and emits ALPACA_ACCOUNT_CHECK. The SF pauses until
    //    CallbackResolver sends back the task token.
    // ---------------------------------------------------------------
    const emitHealthCheck = new sfn.CustomState(this, 'EmitHealthCheck', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke.waitForTaskToken',
        Parameters: {
          FunctionName: emitHealthCheckFn.functionArn,
          Payload: {
            'tenantId.$': '$.tenantId',
            'symbol.$': '$.symbol',
            'taskToken.$': '$$.Task.Token',
            'attemptCount.$': '$.attemptCount',
          },
        },
        TimeoutSeconds: 90,
        ResultPath: '$.healthCheckResult',
        Catch: [
          {
            ErrorEquals: ['States.Timeout', 'States.TaskFailed'],
            Next: 'IncrementAttempt',
            ResultPath: '$.error',
          },
        ],
      },
    });

    // ---------------------------------------------------------------
    // 2. CloseBreaker — DDB UpdateItem (set state=CLOSED)
    // ---------------------------------------------------------------
    const closeBreaker = new sfn.CustomState(this, 'CloseBreaker', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { 'S.$': "States.Format('CircuitBreaker#{}#{}', $.tenantId, $.symbol)" },
            sk: { S: 'CircuitBreaker' },
          },
          UpdateExpression: 'SET #st = :st, closedAt = :ca REMOVE healTaskToken',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: {
            ':st': { S: 'CLOSED' },
            ':ca': { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    // ---------------------------------------------------------------
    // 3. EmitBreakerClosed — Write NormalizedEvent for CDC
    // ---------------------------------------------------------------
    const emitBreakerClosed = new sfn.CustomState(this, 'EmitBreakerClosed', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Parameters: {
          TableName: tableName,
          Item: {
            pk: { 'S.$': "States.Format('NormalizedEvent#{}#CIRCUIT_BREAKER', $.tenantId)" },
            sk: { 'S.$': "States.Format('BROKER_CIRCUIT_CLOSED#{}', $$.State.EnteredTime)" },
            __typename: { S: 'NormalizedEvent' },
            tenantId: { 'S.$': '$.tenantId' },
            symbol: { 'S.$': '$.symbol' },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const endHealed = new sfn.Succeed(this, 'EndHealed');

    // ---------------------------------------------------------------
    // 4. IncrementAttempt — Pass state with counter increment
    // ---------------------------------------------------------------
    const incrementAttempt = new sfn.Pass(this, 'IncrementAttempt', {
      parameters: {
        'tenantId.$': '$.tenantId',
        'symbol.$': '$.symbol',
        'attemptCount.$': 'States.MathAdd($.attemptCount, 1)',
      },
    });

    // ---------------------------------------------------------------
    // 5. CheckAttemptLimit — Choice: attemptCount < 10?
    // ---------------------------------------------------------------
    const checkAttemptLimit = new sfn.Choice(this, 'CheckAttemptLimit');

    // ---------------------------------------------------------------
    // 6. WaitForRetry — Wait 60s before next attempt
    // ---------------------------------------------------------------
    const waitForRetry = new sfn.Wait(this, 'WaitForRetry', {
      time: sfn.WaitTime.duration(Duration.seconds(60)),
    });

    // ---------------------------------------------------------------
    // 7. EscalateHealFailure — Write escalation NormalizedEvent + end
    // ---------------------------------------------------------------
    const escalateHealFailure = new sfn.CustomState(this, 'EscalateHealFailure', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Parameters: {
          TableName: tableName,
          Item: {
            pk: { 'S.$': "States.Format('NormalizedEvent#{}#CIRCUIT_BREAKER', $.tenantId)" },
            sk: { 'S.$': "States.Format('BROKER_HEAL_ESCALATED#{}', $$.State.EnteredTime)" },
            __typename: { S: 'NormalizedEvent' },
            tenantId: { 'S.$': '$.tenantId' },
            symbol: { 'S.$': '$.symbol' },
            failureReason: { S: 'Circuit breaker heal failed after 10 attempts' },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const endEscalated = new sfn.Succeed(this, 'EndEscalated');

    // ---------------------------------------------------------------
    // 8. InitAttemptCount — Pass state to initialize counter if absent
    // ---------------------------------------------------------------
    const initAttemptCount = new sfn.Pass(this, 'InitAttemptCount', {
      parameters: {
        'tenantId.$': '$.tenantId',
        'symbol.$': '$.symbol',
        attemptCount: 0,
      },
    });

    // ===============================================================
    // Wire the chain
    // ===============================================================

    // Success path: CloseBreaker → EmitBreakerClosed → EndHealed
    closeBreaker.next(emitBreakerClosed);
    emitBreakerClosed.next(endHealed);

    // Retry path
    waitForRetry.next(emitHealthCheck);
    incrementAttempt.next(checkAttemptLimit);
    escalateHealFailure.next(endEscalated);

    checkAttemptLimit
      .when(sfn.Condition.numberLessThan('$.attemptCount', 10), waitForRetry)
      .otherwise(escalateHealFailure);

    // Happy path: EmitHealthCheck → CloseBreaker
    emitHealthCheck.next(closeBreaker);

    // Main chain: Init → EmitHealthCheck
    const definition = initAttemptCount.next(emitHealthCheck);

    // ---------------------------------------------------------------
    // State Machine
    // ---------------------------------------------------------------
    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(2),
      tracingEnabled: true,
      stateMachineType: sfn.StateMachineType.STANDARD,
      comment: 'Circuit breaker auto-heal — broker-ctrl',
    });

    // ---------------------------------------------------------------
    // IAM permissions
    // ---------------------------------------------------------------
    table.grantReadWriteData(this.stateMachine);
    emitHealthCheckFn.grantInvoke(this.stateMachine);
  }
}
