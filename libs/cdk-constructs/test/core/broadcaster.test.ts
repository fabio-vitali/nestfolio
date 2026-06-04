import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ServiceStack } from '../../src/core/service-stack';
import { State } from '../../src/core/state';
import { Facade } from '../../src/core/facade';
import { Broadcaster } from '../../src/core/broadcaster';

describe('Broadcaster construct', () => {
  const handlersDir = path.join(os.tmpdir(), 'handlers');
  const publisherEntry = path.join(handlersDir, 'broadcast-publisher.ts');
  const SCHEMA_DIR = path.join(__dirname, '__fixtures__');
  const SCHEMA_PATH = path.join(SCHEMA_DIR, 'broadcaster-schema.graphql');

  beforeAll(() => {
    fs.mkdirSync(handlersDir, { recursive: true });
    fs.writeFileSync(publisherEntry, 'export const handler = async () => {};');
    if (!fs.existsSync(SCHEMA_DIR)) fs.mkdirSync(SCHEMA_DIR, { recursive: true });
    fs.writeFileSync(
      SCHEMA_PATH,
      `type Query { hello(name: String): String }\ntype Mutation { addItem(name: String!): String }`,
    );
  });

  afterAll(() => {
    try { fs.unlinkSync(publisherEntry); } catch { /* ignore */ }
    try { fs.unlinkSync(SCHEMA_PATH); } catch { /* ignore */ }
  });

  function createBroadcaster(
    opts: { withApi?: boolean; broadcasterOverrides?: Record<string, unknown> } = {},
  ) {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ServiceStack(app, 'TestStack', {
      prefix: 'test',
      subsystem: 'test',
      service: 'test-svc',
      serviceDir: os.tmpdir(),
    });
    const state = new State(stack, 'State', { withTable: true });

    let facade: Facade;
    if (opts.withApi ?? true) {
      const userPool = new UserPool(stack, 'Pool');
      const resolver = new Function(stack, 'Resolver', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline('exports.handler = async () => {};'),
      });
      facade = new Facade(stack, 'Facade', {
        schemaPath: SCHEMA_PATH,
        userPool,
        enableIamAuth: true,
        lambdaResolvers: [{ typeName: 'Query', fieldName: 'hello', handler: resolver }],
      });
    } else {
      facade = new Facade(stack, 'Facade', {});
    }

    const broadcaster = new Broadcaster(stack, 'TestBroadcaster', {
      state,
      entry: publisherEntry,
      facade,
      ...(opts.broadcasterOverrides ?? {}),
    });

    return { stack, state, facade, broadcaster, template: Template.fromStack(stack) };
  }

  describe('DLQ + stream config', () => {
    it('creates a DLQ with 14-day retention', () => {
      const { template } = createBroadcaster();
      template.hasResourceProperties('AWS::SQS::Queue', {
        MessageRetentionPeriod: 1209600,
      });
    });

    it('exposes the dlq property', () => {
      const { broadcaster } = createBroadcaster();
      expect(broadcaster.dlq).toBeDefined();
    });

    it('wires the DLQ as the event source onFailure destination', () => {
      const { template } = createBroadcaster();
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
      });
    });

    it('enables bisectBatchOnError so a poison pill cannot drop good records', () => {
      const { template } = createBroadcaster();
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BisectBatchOnFunctionError: true,
      });
    });

    it('defaults retryAttempts to 3', () => {
      const { template } = createBroadcaster();
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        MaximumRetryAttempts: 3,
      });
    });

    it('uses custom retryAttempts', () => {
      const { template } = createBroadcaster({ broadcasterOverrides: { retryAttempts: 5 } });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        MaximumRetryAttempts: 5,
      });
    });

    it('reads the DynamoDB stream from LATEST', () => {
      const { template } = createBroadcaster();
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        StartingPosition: 'LATEST',
      });
    });
  });

  describe('publisher Lambda', () => {
    it('exposes the handler property', () => {
      const { broadcaster } = createBroadcaster();
      expect(broadcaster.handler).toBeDefined();
    });

    it('sets APPSYNC_URL env when the facade has an API', () => {
      const { template } = createBroadcaster({ withApi: true });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: Match.objectLike({ APPSYNC_URL: Match.anyValue() }) },
      });
    });

    it('merges extra environment variables', () => {
      const { template } = createBroadcaster({
        broadcasterOverrides: { environment: { CUSTOM_VAR: 'custom-value' } },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: Match.objectLike({ CUSTOM_VAR: 'custom-value' }) },
      });
    });

    it('applies lambdaProps overrides', () => {
      const { template } = createBroadcaster({
        broadcasterOverrides: { lambdaProps: { memorySize: 512 } },
      });
      template.hasResourceProperties('AWS::Lambda::Function', { MemorySize: 512 });
    });
  });

  describe('AppSync IAM grant', () => {
    it('grants appsync:GraphQL on the API when the facade has an API', () => {
      const { template } = createBroadcaster({ withApi: true });
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ Action: 'appsync:GraphQL' }),
          ]),
        },
      });
    });

    it('omits the AppSync grant when the facade has no API', () => {
      const { template } = createBroadcaster({ withApi: false });
      const policies = template.findResources('AWS::IAM::Policy');
      const hasGraphQLGrant = Object.values(policies).some((policy) =>
        JSON.stringify(policy).includes('appsync:GraphQL'),
      );
      expect(hasGraphQLGrant).toBe(false);
    });
  });
});
