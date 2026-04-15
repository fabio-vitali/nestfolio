import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import { CircuitBreakerHealDefinition } from '../../src/core/circuit-breaker-heal';

describe('CircuitBreakerHealDefinition', () => {
  function createStack() {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const table = new dynamodb.Table(stack, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    });
    const connection = events.Connection.fromConnectionAttributes(stack, 'Conn', {
      connectionArn: 'arn:aws:events:us-east-1:123456789012:connection/alpaca/abc123',
      connectionName: 'alpaca',
      connectionSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:events!connection/alpaca/abc123',
    });
    return { app, stack, table, connection };
  }

  function createDefinition(overrides: Record<string, unknown> = {}) {
    const { stack, table, connection } = createStack();

    const def = new CircuitBreakerHealDefinition(stack, 'HealDef', {
      table,
      breakerKey: (overrides['breakerKey'] as string) ?? 'CircuitBreaker#alpaca',
      events: {
        closed: 'BROKER_CIRCUIT_CLOSED',
        escalated: 'BROKER_HEAL_ESCALATED',
      },
      healthCheck: {
        connection,
        apiRoot: 'https://api.alpaca.markets',
        apiEndpoint: sfn.TaskInput.fromText('/v2/clock'),
        method: sfn.TaskInput.fromText('GET'),
        ...(overrides['healthCheck'] as Record<string, unknown> ?? {}),
      },
      ...(overrides['retry'] !== undefined ? { retry: overrides['retry'] as { maxAttempts?: number; intervalSeconds?: number } } : {}),
      ...(overrides['healthCheckRetry'] !== undefined ? { healthCheckRetry: overrides['healthCheckRetry'] as { maxAttempts?: number; intervalSeconds?: number; backoffRate?: number } } : {}),
    });

    // Create a StateMachine so we can synth and inspect the definition
    new sfn.StateMachine(stack, 'SM', {
      definitionBody: def.definitionBody,
    });

    return { stack, def };
  }

  /**
   * Extract the state machine definition from a synthesized template.
   * The DefinitionString may be an Fn::Join (when it references AWS::Partition),
   * so we resolve it by concatenating the join parts, replacing Ref tokens with
   * a known partition string.
   */
  function extractDefinition(stack: Stack): Record<string, unknown> {
    const template = Template.fromStack(stack);
    const smResources = template.findResources('AWS::StepFunctions::StateMachine');
    const smLogicalId = Object.keys(smResources)[0];
    const props = smResources[smLogicalId].Properties as Record<string, unknown>;
    const defString = props.DefinitionString;

    // If it's a plain string, parse directly
    if (typeof defString === 'string') {
      return JSON.parse(defString);
    }

    // Handle Fn::Join
    const fnJoin = (defString as Record<string, unknown>)['Fn::Join'] as [string, unknown[]];
    if (!fnJoin) throw new Error('Unexpected DefinitionString format');

    const [separator, parts] = fnJoin;
    const resolved = parts.map((part: unknown) => {
      if (typeof part === 'string') return part;
      // Replace { Ref: 'AWS::Partition' } with 'aws'
      if (typeof part === 'object' && part !== null && 'Ref' in part) {
        return 'aws';
      }
      // Replace Fn::GetAtt, Fn::Ref etc. with placeholder
      return '__DYNAMIC__';
    }).join(separator);

    return JSON.parse(resolved);
  }

  it('should produce a definitionBody', () => {
    const { def } = createDefinition();
    expect(def.definitionBody).toBeDefined();
  });

  it('should produce a definitionBody with all expected states', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;

    expect(states['InitAttemptCount']).toBeDefined();
    expect(states['InitAttemptCount'].Type).toBe('Pass');

    expect(states['HealthCheck']).toBeDefined();
    expect(states['HealthCheck'].Type).toBe('Task');

    expect(states['CloseBreaker']).toBeDefined();
    expect(states['CloseBreaker'].Type).toBe('Task');

    expect(states['EmitBreakerClosed']).toBeDefined();
    expect(states['EmitBreakerClosed'].Type).toBe('Task');

    expect(states['IncrementAttempt']).toBeDefined();
    expect(states['IncrementAttempt'].Type).toBe('Pass');

    expect(states['CheckAttemptLimit']).toBeDefined();
    expect(states['CheckAttemptLimit'].Type).toBe('Choice');

    expect(states['WaitForRetry']).toBeDefined();
    expect(states['WaitForRetry'].Type).toBe('Wait');

    expect(states['EscalateHealFailure']).toBeDefined();
    expect(states['EscalateHealFailure'].Type).toBe('Task');

    expect(states['EndHealed']).toBeDefined();
    expect(states['EndHealed'].Type).toBe('Succeed');

    expect(states['EndEscalated']).toBeDefined();
    expect(states['EndEscalated'].Type).toBe('Fail');
  });

  it('should start with InitAttemptCount', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    expect(def.StartAt).toBe('InitAttemptCount');
  });

  it('should use HTTP:Invoke for HealthCheck with correct connection', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;
    const healthCheck = states['HealthCheck'];

    expect(healthCheck.Resource).toBe('arn:aws:states:::http:invoke');
    const params = healthCheck.Parameters as Record<string, unknown>;
    // HttpInvoke formats the endpoint via States.Format
    expect(params['ApiEndpoint.$']).toContain('/v2/clock');
    expect(params['Method']).toBe('GET');
    expect((params['Authentication'] as Record<string, string>).ConnectionArn).toBe(
      'arn:aws:events:us-east-1:123456789012:connection/alpaca/abc123',
    );
  });

  it('should wire HealthCheck retry for transient errors', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;
    const healthCheck = states['HealthCheck'];
    const retries = healthCheck.Retry as Array<Record<string, unknown>>;

    expect(retries).toBeDefined();
    expect(retries.length).toBeGreaterThan(0);
    const errorTypes = retries.flatMap(r => r.ErrorEquals as string[]);
    expect(errorTypes).toContain('States.TaskFailed');
    expect(errorTypes).toContain('States.Timeout');
  });

  it('should wire HealthCheck catch to IncrementAttempt', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;
    const healthCheck = states['HealthCheck'];
    const catches = healthCheck.Catch as Array<Record<string, unknown>>;

    expect(catches).toBeDefined();
    expect(catches.length).toBeGreaterThan(0);
    expect(catches.some(c => c.Next === 'IncrementAttempt')).toBe(true);
  });

  it('should use DDB UpdateItem for CloseBreaker', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;
    const closeBreaker = states['CloseBreaker'];

    expect(closeBreaker.Resource).toBe('arn:aws:states:::dynamodb:updateItem');
    const params = closeBreaker.Parameters as Record<string, unknown>;
    expect(params['UpdateExpression']).toContain('#st = :st');
    const exprValues = params['ExpressionAttributeValues'] as Record<string, Record<string, string>>;
    expect(exprValues[':st'].S).toBe('CLOSED');
  });

  it('should use DDB PutItem for EmitBreakerClosed with NormalizedEvent format', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;
    const emit = states['EmitBreakerClosed'];

    expect(emit.Resource).toBe('arn:aws:states:::dynamodb:putItem');
    const params = emit.Parameters as Record<string, Record<string, Record<string, string>>>;
    expect(params.Item.__typename.S).toBe('NormalizedEvent');
    expect(params.Item.sk['S.$']).toContain('BROKER_CIRCUIT_CLOSED');
  });

  it('should use DDB PutItem for EscalateHealFailure with NormalizedEvent format', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;
    const escalate = states['EscalateHealFailure'];

    expect(escalate.Resource).toBe('arn:aws:states:::dynamodb:putItem');
    const params = escalate.Parameters as Record<string, Record<string, Record<string, string>>>;
    expect(params.Item.__typename.S).toBe('NormalizedEvent');
    expect(params.Item.sk['S.$']).toContain('BROKER_HEAL_ESCALATED');
  });

  it('should use default retry config (10 attempts, 60s wait)', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;

    expect(states['WaitForRetry'].Seconds).toBe(60);

    const choices = states['CheckAttemptLimit'].Choices as Array<Record<string, unknown>>;
    expect(choices.some(c => c.NumericLessThan === 10)).toBe(true);
  });

  it('should accept custom retry config', () => {
    const { stack } = createDefinition({
      retry: { maxAttempts: 5, intervalSeconds: 30 },
    });
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;

    expect(states['WaitForRetry'].Seconds).toBe(30);

    const choices = states['CheckAttemptLimit'].Choices as Array<Record<string, unknown>>;
    expect(choices.some(c => c.NumericLessThan === 5)).toBe(true);
  });

  it('should wire the full happy path: Init → HealthCheck → CloseBreaker → EmitBreakerClosed → EndHealed', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;

    expect(states['InitAttemptCount'].Next).toBe('HealthCheck');
    expect(states['HealthCheck'].Next).toBe('CloseBreaker');
    expect(states['CloseBreaker'].Next).toBe('EmitBreakerClosed');
    expect(states['EmitBreakerClosed'].Next).toBe('EndHealed');
  });

  it('should wire the failure/retry flow: IncrementAttempt → CheckAttemptLimit → WaitForRetry → HealthCheck', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;

    expect(states['IncrementAttempt'].Next).toBe('CheckAttemptLimit');
    expect(states['WaitForRetry'].Next).toBe('HealthCheck');
  });

  it('should wire escalation: CheckAttemptLimit default → EscalateHealFailure → EndEscalated', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;

    expect(states['CheckAttemptLimit'].Default).toBe('EscalateHealFailure');
    expect(states['EscalateHealFailure'].Next).toBe('EndEscalated');
  });
});
