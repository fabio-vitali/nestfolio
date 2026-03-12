import { App, Stack } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Facade, parseSchemaFields } from '../src/facade';
import * as path from 'path';
import * as fs from 'fs';
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

describe('Facade construct', () => {
  it('creates AppSync API when schemaPath and userPool are both provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const userPool = new UserPool(stack, 'Pool');

    const facade = new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
    });

    expect(facade.api).toBeDefined();
    expect(facade.graphqlUrl).toBeDefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::AppSync::GraphQLApi', 1);
  });

  it('does not create AppSync API when schemaPath is not provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const facade = new Facade(stack, 'TestFacade', {});

    expect(facade.api).toBeUndefined();
    expect(facade.graphqlUrl).toBeUndefined();

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::AppSync::GraphQLApi', 0);
  });

  it('adds CDK error annotation when schemaPath is set without userPool', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    const facade = new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
    });

    expect(facade.api).toBeUndefined();

    const annotations = Annotations.fromStack(stack);
    annotations.hasError('/TestStack/TestFacade', Match.stringLikeRegexp('schemaPath requires a userPool'));
  });

  it('creates SSM parameter when ssmPrefix is provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const userPool = new UserPool(stack, 'Pool');

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      ssmPrefix: '/nestfolio/dev-test',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/dev-test/api/graphqlUrl',
    });
  });

  it('creates Lambda resolvers when lambdaResolvers provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const userPool = new UserPool(stack, 'Pool');
    const resolver = new Function(stack, 'Resolver', {
      runtime: Runtime.NODEJS_20_X,
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

  it('creates no resolvers when neither jsResolvers nor lambdaResolvers provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const userPool = new UserPool(stack, 'Pool');

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
    });

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::AppSync::DataSource', 0);
    template.resourceCountIs('AWS::AppSync::Resolver', 0);
  });
});

describe('JS resolver support', () => {
  it('creates DynamoDB data source when table and jsResolvers provided', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const userPool = new UserPool(stack, 'Pool');
    const table = new Table(stack, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      table,
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
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const userPool = new UserPool(stack, 'Pool');
    const table = new Table(stack, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    new Facade(stack, 'TestFacade', {
      schemaPath: SCHEMA_PATH,
      userPool,
      table,
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
