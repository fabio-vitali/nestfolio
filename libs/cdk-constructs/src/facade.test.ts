import { App, Stack } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Facade, parseSchemaFields } from './facade';
import * as path from 'path';
import * as fs from 'fs';

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
  if (fs.existsSync(SCHEMA_DIR)) fs.rmdirSync(SCHEMA_DIR);
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

  it('wires default resolver function to all Query and Mutation fields', () => {
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
      resolverFunctions: { default: resolver },
    });

    const template = Template.fromStack(stack);

    // Should create a Lambda data source
    template.resourceCountIs('AWS::AppSync::DataSource', 1);

    // Should create resolvers for hello, items (Query) and addItem (Mutation)
    template.resourceCountIs('AWS::AppSync::Resolver', 3);

    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Query',
      FieldName: 'hello',
    });
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Query',
      FieldName: 'items',
    });
    template.hasResourceProperties('AWS::AppSync::Resolver', {
      TypeName: 'Mutation',
      FieldName: 'addItem',
    });
  });

  it('creates no resolvers when resolverFunctions is not provided', () => {
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
