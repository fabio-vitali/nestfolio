import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Facade, parseSchemaFields, discoverJsResolvers } from '../../src/core/facade';
import { ServiceStack } from '../../src/core/service-stack';
import { State } from '../../src/core/state';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';

// Create a temporary schema file for tests
const SCHEMA_DIR = path.join(__dirname, '__fixtures__');
const SCHEMA_PATH = path.join(SCHEMA_DIR, 'test-schema.graphql');

beforeAll(() => {
  if (!fs.existsSync(SCHEMA_DIR)) fs.mkdirSync(SCHEMA_DIR, { recursive: true });
  fs.writeFileSync(
    SCHEMA_PATH,
    `type Query {
  hello(name: String): String
  items: [String]
}

type Mutation {
  addItem(name: String!): String
}`,
  );
});

afterAll(() => {
  if (fs.existsSync(SCHEMA_PATH)) fs.unlinkSync(SCHEMA_PATH);
});

function createFacadeStack(opts?: { withState?: boolean }) {
  const app = new App({ context: { prefix: 'test' } });
  const stack = new ServiceStack(app, 'TestStack', {
    prefix: 'test',
    subsystem: 'test',
    service: 'test-svc',
    serviceDir: os.tmpdir(),
  });
  const withState = opts?.withState ?? true;
  const state = withState ? new State(stack, 'State', { withTable: true }) : undefined;
  return { app, stack, state };
}

describe('Facade construct', () => {
  it('does not create API when no resolvers provided', () => {
    const { stack } = createFacadeStack();

    const facade = new Facade(stack, 'TestFacade', {});

    expect(facade.api).toBeUndefined();
    expect(facade.graphqlUrl).toBeUndefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::AppSync::GraphQLApi', 0);
  });

  it('creates AppSync API when lambdaResolvers provided with explicit userPool', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    const facade = new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    expect(facade.api).toBeDefined();
    expect(facade.graphqlUrl).toBeDefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::AppSync::GraphQLApi', 1);
  });

  it('adds IAM as additional auth mode when enableIamAuth is true', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      enableIamAuth: true,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      AuthenticationType: 'AMAZON_COGNITO_USER_POOLS',
      AdditionalAuthenticationProviders: [
        { AuthenticationType: 'AWS_IAM' },
      ],
    });
  });

  it('does not add IAM auth mode when enableIamAuth is false', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      AuthenticationType: 'AMAZON_COGNITO_USER_POOLS',
    });
    // Verify no IAM additional provider
    const resources = template.findResources('AWS::AppSync::GraphQLApi');
    const apiResource = Object.values(resources)[0] as { Properties: { AdditionalAuthenticationProviders?: unknown[] } };
    expect(apiResource.Properties.AdditionalAuthenticationProviders).toBeUndefined();
  });

  it('creates SSM parameter when API exists', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-test-svc/api/graphqlUrl',
    });
  });

  it('creates an SSM parameter for api/realtimeUrl', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-test-svc/api/realtimeUrl',
      Value: Match.anyValue(),
    });
  });

  it('creates Lambda resolvers when lambdaResolvers provided', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
        { typeName: 'Query', fieldName: 'items', handler: resolver },
        { typeName: 'Mutation', fieldName: 'addItem', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::AppSync::DataSource', {
      Type: 'AWS_LAMBDA',
    });
    template.resourceCountIs('AWS::AppSync::Resolver', 3);
  });

  it('does not create WAF in non-prod environments by default', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::WAFv2::WebACL', 0);
  });

  it('creates WAF when waf is enabled on ServiceStack', () => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ServiceStack(app, 'WafStack', {
      prefix: 'test',
      subsystem: 'test',
      service: 'test-svc',
      serviceDir: os.tmpdir(),
      waf: true,
    });
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
  });

  it('creates WAF when explicitly enabled regardless of prefix', () => {
    const { stack } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      enableWaf: true,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  });

  it('creates no resolvers when neither jsResolvers nor lambdaResolvers provided', () => {
    const { stack } = createFacadeStack();

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::AppSync::GraphQLApi', 0);
    template.resourceCountIs('AWS::AppSync::DataSource', 0);
    template.resourceCountIs('AWS::AppSync::Resolver', 0);
  });
});

describe('JS resolver support', () => {
  it('creates DynamoDB data source when jsResolvers provided', () => {
    const { stack, state } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');

    new Facade(stack, 'TestFacade', {
      state,
      schemaPath: SCHEMA_PATH,
      userPool,
      jsResolvers: [
        {
          typeName: 'Query',
          fieldName: 'hello',
          pipeline: [join(__dirname, '__fixtures__', 'check-auth.fn.js'), join(__dirname, '__fixtures__', 'get-items.fn.js')],
        },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::AppSync::DataSource', {
      Type: 'AMAZON_DYNAMODB',
    });
    template.hasResourceProperties('AWS::AppSync::DataSource', {
      Type: 'NONE',
    });
  });

  it('creates pipeline resolvers with JS_1_0_0 runtime', () => {
    const { stack, state } = createFacadeStack();
    const userPool = new UserPool(stack, 'Pool');

    new Facade(stack, 'TestFacade', {
      state,
      schemaPath: SCHEMA_PATH,
      userPool,
      jsResolvers: [
        {
          typeName: 'Query',
          fieldName: 'hello',
          pipeline: [join(__dirname, '__fixtures__', 'check-auth.fn.js'), join(__dirname, '__fixtures__', 'get-items.fn.js')],
        },
      ],
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      Kind: 'PIPELINE',
      Runtime: { Name: 'APPSYNC_JS', RuntimeVersion: '1.0.0' },
    });
  });

  it('Facade without state skips jsResolvers (noneDataSource pattern)', () => {
    const { stack } = createFacadeStack({ withState: false });
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
    });

    const facade = new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      lambdaResolvers: [
        { typeName: 'Query', fieldName: 'hello', handler: resolver },
      ],
      jsResolvers: [
        {
          typeName: 'Query',
          fieldName: 'items',
          pipeline: [join(__dirname, '__fixtures__', 'check-auth.fn.js'), join(__dirname, '__fixtures__', 'get-items.fn.js')],
        },
      ],
    });

    expect(facade.api).toBeDefined();
    const template = Template.fromStack(stack);
    // Lambda resolvers should work, but DynamoDB data source should not be created
    template.hasResourceProperties('AWS::AppSync::DataSource', {
      Type: 'AWS_LAMBDA',
    });
    template.resourceCountIs('AWS::AppSync::Resolver', 1); // only the lambda resolver
  });
});

describe('discoverJsResolvers', () => {
  const tmpDir = path.join(os.tmpdir(), 'discover-test-' + Date.now());
  const jsFnDir = path.join(tmpDir, 'graphql', 'js-function');
  const utilsDir = path.join(jsFnDir, 'utils');
  const schemaPath = path.join(tmpDir, 'schema.graphql');

  beforeAll(() => {
    fs.mkdirSync(utilsDir, { recursive: true });
    // Create schema
    fs.writeFileSync(schemaPath, `
      type Query {
        getProfile: Profile
        getGoals: [Goal]
      }
      type Mutation {
        setGoal(input: GoalInput!): Goal
      }
    `);
    // Create JS function stubs
    fs.writeFileSync(path.join(utilsDir, 'check-auth.fn.js'), 'export function request(ctx) { return {}; }');
    fs.writeFileSync(path.join(jsFnDir, 'get-profile.fn.js'), 'export function request(ctx) { return {}; }');
    fs.writeFileSync(path.join(jsFnDir, 'get-goals.fn.js'), 'export function request(ctx) { return {}; }');
    fs.writeFileSync(path.join(jsFnDir, 'set-goal.fn.js'), 'export function request(ctx) { return {}; }');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers all Query and Mutation fields', () => {
    const resolvers = discoverJsResolvers(tmpDir);
    expect(resolvers).toHaveLength(3);
    expect(resolvers[0]).toEqual({
      typeName: 'Query',
      fieldName: 'getProfile',
      pipeline: [
        path.join(jsFnDir, 'utils', 'check-auth.fn.js'),
        path.join(jsFnDir, 'get-profile.fn.js'),
      ],
    });
  });

  it('converts camelCase to kebab-case for file names', () => {
    const resolvers = discoverJsResolvers(tmpDir);
    const setGoal = resolvers.find(r => r.fieldName === 'setGoal');
    expect(setGoal?.pipeline[1]).toContain('set-goal.fn.js');
  });

  it('excludes specified fields', () => {
    const resolvers = discoverJsResolvers(tmpDir, { exclude: ['getGoals'] });
    expect(resolvers).toHaveLength(2);
    expect(resolvers.find(r => r.fieldName === 'getGoals')).toBeUndefined();
  });

  it('marks noneDataSource fields', () => {
    const resolvers = discoverJsResolvers(tmpDir, { noneDataSource: ['setGoal'] });
    const setGoal = resolvers.find(r => r.fieldName === 'setGoal');
    expect(setGoal?.dataSource).toBe('none');
  });

  it('adds extra pipeline steps', () => {
    const resolvers = discoverJsResolvers(tmpDir, {
      extraSteps: { setGoal: ['readback.fn.js'] },
    });
    const setGoal = resolvers.find(r => r.fieldName === 'setGoal');
    expect(setGoal?.pipeline).toHaveLength(3);
    expect(setGoal?.pipeline[2]).toContain('readback.fn.js');
  });
});

describe('parseSchemaFields', () => {
  it('parses complex return types (lists, non-null, nested)', () => {
    const schema = `
      type Query {
        getItems(limit: Int!): [Item!]!
        getUser(id: ID!): User
        health: HealthStatus!
      }
      type Mutation {
        createItem(input: CreateItemInput!): Item!
        deleteItem(id: ID!): Boolean
      }
      type Item {
        id: ID!
        name: String!
      }
    `;
    const fields = parseSchemaFields(schema);
    expect(fields).toEqual([
      { typeName: 'Query', fieldName: 'getItems' },
      { typeName: 'Query', fieldName: 'getUser' },
      { typeName: 'Query', fieldName: 'health' },
      { typeName: 'Mutation', fieldName: 'createItem' },
      { typeName: 'Mutation', fieldName: 'deleteItem' },
    ]);
  });

  it('parses multi-line field definitions with descriptions and directives', () => {
    const schema = `
      type Query {
        """
        Get a paginated list of portfolios.
        """
        getPortfolios(
          tenantId: String!
          cursor: String
          limit: Int
        ): PortfolioConnection! @auth(requires: USER)

        getPositions(portfolioId: ID!): [Position!]!
      }
    `;
    const fields = parseSchemaFields(schema);
    expect(fields).toEqual([
      { typeName: 'Query', fieldName: 'getPortfolios' },
      { typeName: 'Query', fieldName: 'getPositions' },
    ]);
  });

  it('ignores comments in schema', () => {
    const schema = `
      # This is the main query type
      type Query {
        # Returns the dashboard data
        getDashboard(tenantId: String!): Dashboard
        # Health check
        health: String
      }

      # Mutations for the app
      type Mutation {
        # Update a setting
        updateSetting(key: String!, value: String!): Setting
      }
    `;
    const fields = parseSchemaFields(schema);
    expect(fields).toEqual([
      { typeName: 'Query', fieldName: 'getDashboard' },
      { typeName: 'Query', fieldName: 'health' },
      { typeName: 'Mutation', fieldName: 'updateSetting' },
    ]);
  });

  it('throws descriptive error for invalid schema', () => {
    expect(() => parseSchemaFields('invalid { schema }')).toThrow('Failed to parse GraphQL schema');
  });
});
