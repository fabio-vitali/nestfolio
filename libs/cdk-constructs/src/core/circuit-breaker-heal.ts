import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Connection } from 'aws-cdk-lib/aws-events';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface CircuitBreakerHealDefinitionProps {
  /** DynamoDB table for breaker state and NormalizedEvent writes */
  readonly table: ITable;
  /** DynamoDB partition key prefix for the breaker record, e.g. 'CircuitBreaker#alpaca' */
  readonly breakerKey: string;
  /** Event names for CDC-emitted NormalizedEvents */
  readonly events: {
    /** Event name written to sk when breaker closes, e.g. 'BROKER_CIRCUIT_CLOSED' */
    readonly closed: string;
    /** Event name written to sk when heal is escalated, e.g. 'BROKER_HEAL_ESCALATED' */
    readonly escalated: string;
  };
  /** HTTP health check configuration using EventBridge Connection credentials */
  readonly healthCheck: {
    /** EventBridge Connection providing auth credentials for the HTTP call */
    readonly connection: Connection;
    /** Base URL for the health check API, e.g. 'https://api.alpaca.markets' */
    readonly apiRoot: string;
    /** API endpoint path, e.g. sfn.TaskInput.fromText('/v2/clock') */
    readonly apiEndpoint: sfn.TaskInput;
    /** HTTP method, e.g. sfn.TaskInput.fromText('GET') */
    readonly method: sfn.TaskInput;
    /** Timeout for the HTTP call in seconds (default: 10) */
    readonly timeoutSeconds?: number;
  };
  /** Outer retry loop configuration */
  readonly retry?: {
    /** Maximum heal attempts before escalation (default: 10) */
    readonly maxAttempts?: number;
    /** Seconds to wait between retry attempts (default: 60) */
    readonly intervalSeconds?: number;
  };
  /** Inner HTTP call retry configuration (for transient 5XX / task failures) */
  readonly healthCheckRetry?: {
    /** Max retries for a single HTTP call (default: 3) */
    readonly maxAttempts?: number;
    /** Initial retry interval in seconds (default: 5) */
    readonly intervalSeconds?: number;
    /** Exponential backoff rate (default: 2) */
    readonly backoffRate?: number;
  };
}

/**
 * Generic CDK construct that produces a Step Functions DefinitionBody for
 * a circuit breaker healing workflow.
 *
 * Flow:
 * 1. InitAttemptCount (Pass) → set attemptCount=0
 * 2. HealthCheck (HTTP:Invoke via EventBridge Connection) → with retry on 5XX/TaskFailed/Timeout
 * 3. Success → CloseBreaker (DDB UpdateItem) → EmitBreakerClosed (DDB PutItem NormalizedEvent) → EndHealed
 * 4. Failure → IncrementAttempt → CheckAttemptLimit
 *    - < maxAttempts → WaitForRetry → loop to HealthCheck
 *    - >= maxAttempts → EscalateHealFailure (DDB PutItem NormalizedEvent) → EndEscalated
 *
 * The definitionBody output is passed directly to the Orchestration construct.
 */
export class CircuitBreakerHealDefinition extends Construct {
  readonly definitionBody: sfn.DefinitionBody;

  constructor(scope: Construct, id: string, props: CircuitBreakerHealDefinitionProps) {
    super(scope, id);

    const { table, breakerKey, events: eventNames, healthCheck } = props;
    const tableName = table.tableName;

    const maxAttempts = props.retry?.maxAttempts ?? 10;
    const intervalSeconds = props.retry?.intervalSeconds ?? 60;

    const hcRetryMaxAttempts = props.healthCheckRetry?.maxAttempts ?? 3;
    const hcRetryInterval = props.healthCheckRetry?.intervalSeconds ?? 5;
    const hcRetryBackoff = props.healthCheckRetry?.backoffRate ?? 2;
    const hcTimeout = healthCheck.timeoutSeconds ?? 10;

    // ---------------------------------------------------------------
    // 1. InitAttemptCount — initialize counter
    // ---------------------------------------------------------------
    // Extract RequestContext fields from the EventBridge event detail structure
    // ($.context.tenantId, $.context.userId, $.context.region, $.subject.adapter)
    const initAttemptCount = new sfn.Pass(this, 'InitAttemptCount', {
      parameters: {
        'tenantId.$': '$.context.tenantId',
        'userId.$': '$.context.userId',
        'region.$': '$.context.region',
        'adapter.$': '$.subject.adapter',
        attemptCount: 0,
      },
    });

    // ---------------------------------------------------------------
    // 2. HealthCheck — HTTP:Invoke via EventBridge Connection
    // ---------------------------------------------------------------
    const healthCheckState = new tasks.HttpInvoke(this, 'HealthCheck', {
      connection: healthCheck.connection,
      apiRoot: healthCheck.apiRoot,
      apiEndpoint: healthCheck.apiEndpoint,
      method: healthCheck.method,
      resultPath: '$.healthCheckResult',
      taskTimeout: sfn.Timeout.duration(Duration.seconds(hcTimeout)),
    });

    // Add retry for transient HTTP errors
    healthCheckState.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      maxAttempts: hcRetryMaxAttempts,
      interval: Duration.seconds(hcRetryInterval),
      backoffRate: hcRetryBackoff,
    });

    // ---------------------------------------------------------------
    // 3. CloseBreaker — DDB UpdateItem (set state=CLOSED)
    // ---------------------------------------------------------------
    const closeBreaker = new sfn.CustomState(this, 'CloseBreaker', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { 'S.$': `States.Format('${breakerKey}#{}', $.tenantId)` },
            sk: { S: breakerKey.split('#')[0] ?? 'CircuitBreaker' },
          },
          UpdateExpression: 'SET #st = :st, closedAt = :ca',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: {
            ':st': { S: 'CLOSED' },
            ':ca': { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: null,
      },
    });

    // ---------------------------------------------------------------
    // 4. EmitBreakerClosed — DDB PutItem (NormalizedEvent for CDC)
    // ---------------------------------------------------------------
    const emitBreakerClosed = new sfn.CustomState(this, 'EmitBreakerClosed', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Parameters: {
          TableName: tableName,
          Item: {
            pk: { 'S.$': "States.Format('NormalizedEvent#{}#CIRCUIT_BREAKER', $.tenantId)" },
            sk: { 'S.$': `States.Format('${eventNames.closed}#{}', $$.State.EnteredTime)` },
            __typename: { S: 'NormalizedEvent' },
            tenantId: { 'S.$': '$.tenantId' },
            userId: { S: 'SYSTEM' },
            region: { 'S.$': '$.region' },
            adapter: { 'S.$': '$.adapter' },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: null,
      },
    });

    const endHealed = new sfn.Succeed(this, 'EndHealed');

    // ---------------------------------------------------------------
    // 5. IncrementAttempt — Pass state with counter increment
    // ---------------------------------------------------------------
    const incrementAttempt = new sfn.Pass(this, 'IncrementAttempt', {
      parameters: {
        'tenantId.$': '$.tenantId',
        'attemptCount.$': 'States.MathAdd($.attemptCount, 1)',
      },
    });

    // ---------------------------------------------------------------
    // 6. CheckAttemptLimit — Choice: attemptCount < maxAttempts?
    // ---------------------------------------------------------------
    const checkAttemptLimit = new sfn.Choice(this, 'CheckAttemptLimit');

    // ---------------------------------------------------------------
    // 7. WaitForRetry — Wait before next attempt
    // ---------------------------------------------------------------
    const waitForRetry = new sfn.Wait(this, 'WaitForRetry', {
      time: sfn.WaitTime.duration(Duration.seconds(intervalSeconds)),
    });

    // ---------------------------------------------------------------
    // 8. EscalateHealFailure — DDB PutItem (NormalizedEvent for CDC)
    // ---------------------------------------------------------------
    const escalateHealFailure = new sfn.CustomState(this, 'EscalateHealFailure', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Parameters: {
          TableName: tableName,
          Item: {
            pk: { 'S.$': "States.Format('NormalizedEvent#{}#CIRCUIT_BREAKER', $.tenantId)" },
            sk: { 'S.$': `States.Format('${eventNames.escalated}#{}', $$.State.EnteredTime)` },
            __typename: { S: 'NormalizedEvent' },
            tenantId: { 'S.$': '$.tenantId' },
            userId: { S: 'SYSTEM' },
            region: { 'S.$': '$.region' },
            adapter: { 'S.$': '$.adapter' },
            failureReason: { S: `Circuit breaker heal failed after ${maxAttempts} attempts` },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: null,
      },
    });

    const endEscalated = new sfn.Fail(this, 'EndEscalated', {
      error: 'HealAttemptsExhausted',
      cause: `Circuit breaker healing failed after ${maxAttempts} attempts`,
    });

    // ===============================================================
    // Wire the chain
    // ===============================================================

    // Success path: HealthCheck → CloseBreaker → EmitBreakerClosed → EndHealed
    closeBreaker.next(emitBreakerClosed);
    emitBreakerClosed.next(endHealed);

    // Failure path: IncrementAttempt → CheckAttemptLimit
    incrementAttempt.next(checkAttemptLimit);

    // Retry loop: WaitForRetry → HealthCheck
    waitForRetry.next(healthCheckState);

    // Escalation path: EscalateHealFailure → EndEscalated
    escalateHealFailure.next(endEscalated);

    // CheckAttemptLimit: < maxAttempts → WaitForRetry, otherwise → EscalateHealFailure
    checkAttemptLimit
      .when(sfn.Condition.numberLessThan('$.attemptCount', maxAttempts), waitForRetry)
      .otherwise(escalateHealFailure);

    // HealthCheck catch → IncrementAttempt (after retry exhaustion)
    healthCheckState.addCatch(incrementAttempt, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Happy path: HealthCheck → CloseBreaker
    healthCheckState.next(closeBreaker);

    // Main chain: Init → HealthCheck
    const definition = initAttemptCount.next(healthCheckState);

    // ---------------------------------------------------------------
    // Definition Body — consumed by Orchestration construct
    // ---------------------------------------------------------------
    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
  }
}
