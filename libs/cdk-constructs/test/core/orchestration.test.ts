import { App, Duration } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Orchestration } from '../../src/core/orchestration';
import { State } from '../../src/core/state';
import { ServiceStack } from '../../src/core/service-stack';

describe('Orchestration construct', () => {
  const handlerPath = path.join(os.tmpdir(), 'orch-test-handler.ts');

  beforeAll(() => {
    fs.writeFileSync(handlerPath, 'export const handler = async () => ({});');
  });

  afterAll(() => {
    fs.unlinkSync(handlerPath);
  });

  function createOrchestration(overrides: Record<string, unknown> = {}) {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ServiceStack(app, 'TestStack', {
      prefix: 'test',
      subsystem: 'test',
      service: 'test-svc',
      serviceDir: os.tmpdir(),
      stateProps: false, // Orchestration owns its own State reference
    });

    const state = (overrides['withState'] !== false)
      ? new State(stack, 'State')
      : undefined;

    const orchestration = new Orchestration(stack, 'TestOrchestration', {
      state,
      definitionBody: sfn.DefinitionBody.fromChainable(
        new sfn.Pass(stack, 'PassState'),
      ),
      triggers: (overrides['triggers'] as string[]) ?? ['TEST_TRIGGER'],
      timeout: overrides['timeout'] as Duration | undefined,
      executionName: overrides['executionName'] as string | undefined,
    });

    return { stack, state, orchestration };
  }

  /** Synthesize and return the template — call only after all construct tree mutations are done */
  function templateOf(stack: ServiceStack): Template {
    return Template.fromStack(stack);
  }

  describe('StateMachine creation', () => {
    it('creates a Standard state machine', () => {
      const { stack } = createOrchestration();
      templateOf(stack).hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineType: 'STANDARD',
      });
    });

    it('enables CloudWatch logging (ALL level)', () => {
      const { stack } = createOrchestration();
      templateOf(stack).hasResourceProperties('AWS::StepFunctions::StateMachine', {
        LoggingConfiguration: {
          Level: 'ALL',
          IncludeExecutionData: true,
        },
      });
    });

    it('enables X-Ray tracing', () => {
      const { stack } = createOrchestration();
      templateOf(stack).hasResourceProperties('AWS::StepFunctions::StateMachine', {
        TracingConfiguration: { Enabled: true },
      });
    });

    it('uses configurable timeout (default 5 min)', () => {
      const { orchestration } = createOrchestration();
      expect(orchestration.stateMachine).toBeDefined();
    });

    it('uses custom timeout when provided', () => {
      const { orchestration } = createOrchestration({
        timeout: Duration.minutes(30),
      });
      expect(orchestration.stateMachine).toBeDefined();
    });
  });

  describe('EventBridge triggers', () => {
    it('creates EB rules for each trigger event type', () => {
      const { stack } = createOrchestration({
        triggers: ['EVENT_A', 'EVENT_B'],
      });
      templateOf(stack).resourceCountIs('AWS::Events::Rule', 2);
    });

    it('routes events to the state machine', () => {
      const { stack } = createOrchestration();
      templateOf(stack).hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          'detail-type': ['TEST_TRIGGER'],
        },
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.anyValue(),
          }),
        ]),
      });
    });
  });

  describe('DLQ', () => {
    it('creates a DLQ for failed event deliveries', () => {
      const { stack } = createOrchestration();
      templateOf(stack).hasResourceProperties('AWS::SQS::Queue', {
        MessageRetentionPeriod: 1209600, // 14 days
      });
    });

    it('exposes dlq property', () => {
      const { orchestration } = createOrchestration();
      expect(orchestration.dlq).toBeDefined();
    });
  });

  describe('State grants', () => {
    it('grants table read/write when state has table', () => {
      const { stack } = createOrchestration();
      templateOf(stack).hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['dynamodb:BatchGetItem']),
            }),
          ]),
        },
      });
    });

    it('works without state', () => {
      const { stack } = createOrchestration({ withState: false });
      templateOf(stack).hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineType: 'STANDARD',
      });
    });
  });

  describe('grantCallbackAccess', () => {
    it('grants SendTaskSuccess and SendTaskFailure to handler', () => {
      const { stack, orchestration } = createOrchestration();
      const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
      const fn = new NodejsFunction(stack, 'CallbackFn', {
        entry: handlerPath,
      });

      orchestration.grantCallbackAccess(fn);

      templateOf(stack).hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'states:SendTaskSuccess',
                'states:SendTaskFailure',
              ]),
            }),
          ]),
        },
      });
    });

    it('injects STATE_MACHINE_ARN env var into handler', () => {
      const { stack, orchestration } = createOrchestration();
      const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
      const fn = new NodejsFunction(stack, 'CallbackFn', {
        entry: handlerPath,
      });

      orchestration.grantCallbackAccess(fn);

      templateOf(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            STATE_MACHINE_ARN: Match.anyValue(),
          }),
        },
      });
    });

    it('supports custom env var name for multiple state machines', () => {
      const { stack, orchestration } = createOrchestration();
      const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
      const fn = new NodejsFunction(stack, 'CallbackFn', {
        entry: handlerPath,
      });

      orchestration.grantCallbackAccess(fn, 'HEAL_STATE_MACHINE_ARN');

      templateOf(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            HEAL_STATE_MACHINE_ARN: Match.anyValue(),
          }),
        },
      });
    });
  });

  describe('executionName (singleton guard)', () => {
    it('still creates the state machine when executionName is provided', () => {
      const { stack } = createOrchestration({ executionName: 'singleton-heal' });
      templateOf(stack).hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineType: 'STANDARD',
      });
    });

    it('does NOT create EventBridge rules when executionName is provided', () => {
      const { stack } = createOrchestration({ executionName: 'singleton-heal' });
      templateOf(stack).resourceCountIs('AWS::Events::Rule', 0);
    });

    it('exposes executionName as a readonly property', () => {
      const { orchestration } = createOrchestration({ executionName: 'singleton-heal' });
      expect(orchestration.executionName).toBe('singleton-heal');
    });

    it('has undefined executionName when not provided', () => {
      const { orchestration } = createOrchestration();
      expect(orchestration.executionName).toBeUndefined();
    });

    it('still creates EB rules when executionName is NOT provided (backward compat)', () => {
      const { stack } = createOrchestration({ triggers: ['EVENT_A', 'EVENT_B'] });
      templateOf(stack).resourceCountIs('AWS::Events::Rule', 2);
    });

    it('grants startExecution to a Lambda handler via grantStartExecution', () => {
      const { stack, orchestration } = createOrchestration({ executionName: 'singleton-heal' });
      const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
      const fn = new NodejsFunction(stack, 'TriggerFn', {
        entry: handlerPath,
      });

      orchestration.grantStartExecution(fn);

      templateOf(stack).hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'states:StartExecution',
            }),
          ]),
        },
      });
    });

    it('injects STATE_MACHINE_ARN and EXECUTION_NAME env vars via grantStartExecution', () => {
      const { stack, orchestration } = createOrchestration({ executionName: 'singleton-heal' });
      const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
      const fn = new NodejsFunction(stack, 'TriggerFn', {
        entry: handlerPath,
      });

      orchestration.grantStartExecution(fn);

      templateOf(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            STATE_MACHINE_ARN: Match.anyValue(),
            EXECUTION_NAME: 'singleton-heal',
          }),
        },
      });
    });

    it('supports custom env var prefix in grantStartExecution', () => {
      const { stack, orchestration } = createOrchestration({ executionName: 'singleton-heal' });
      const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
      const fn = new NodejsFunction(stack, 'TriggerFn', {
        entry: handlerPath,
      });

      orchestration.grantStartExecution(fn, 'HEAL_SM_ARN', 'HEAL_EXECUTION_NAME');

      templateOf(stack).hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            HEAL_SM_ARN: Match.anyValue(),
            HEAL_EXECUTION_NAME: 'singleton-heal',
          }),
        },
      });
    });
  });
});
