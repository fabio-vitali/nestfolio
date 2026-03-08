import { Construct } from 'constructs';
import { Annotations } from 'aws-cdk-lib';
import {
  GraphqlApi,
  SchemaFile,
  AuthorizationType,
  MappingTemplate,
} from 'aws-cdk-lib/aws-appsync';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import * as fs from 'fs';
import { parse, visit } from 'graphql';

export interface FacadeProps {
  /** Path to GraphQL schema file (for BFF services) */
  schemaPath?: string;
  /** Cognito User Pool for authentication (AD-9) */
  userPool?: IUserPool;
  /** Lambda resolvers for AppSync */
  resolverFunctions?: Record<string, IFunction>;
  /** DynamoDB table for direct resolvers */
  table?: ITable;
  /** SSM parameter path prefix for outputs (e.g., /nestfolio/dev-advisory) */
  ssmPrefix?: string;
}

export class Facade extends Construct {
  readonly api?: GraphqlApi;
  readonly graphqlUrl?: string;

  constructor(scope: Construct, id: string, props: FacadeProps) {
    super(scope, id);

    if (props.schemaPath && !props.userPool) {
      Annotations.of(this).addError(
        'Facade: schemaPath requires a userPool for AppSync authentication. Provide a userPool or remove schemaPath.',
      );
      return;
    }

    if (props.schemaPath && props.userPool) {
      this.api = new GraphqlApi(this, 'Api', {
        name: `${id}-api`,
        schema: SchemaFile.fromAsset(props.schemaPath),
        authorizationConfig: {
          defaultAuthorization: {
            authorizationType: AuthorizationType.USER_POOL,
            userPoolConfig: { userPool: props.userPool },
          },
        },
      });
      this.graphqlUrl = this.api.graphqlUrl;

      // Wire resolver functions to all Query and Mutation fields
      if (props.resolverFunctions?.default) {
        const ds = this.api.addLambdaDataSource('DefaultDS', props.resolverFunctions.default);
        const fieldNames = this.parseSchemaFields(props.schemaPath);
        for (const { typeName, fieldName } of fieldNames) {
          ds.createResolver(`${typeName}${fieldName}Resolver`, {
            typeName,
            fieldName,
            requestMappingTemplate: MappingTemplate.lambdaRequest(),
            responseMappingTemplate: MappingTemplate.lambdaResult(),
          });
        }
      }

      if (props.ssmPrefix && this.api) {
        new StringParameter(this, 'ApiUrlParam', {
          parameterName: `${props.ssmPrefix}/api/graphqlUrl`,
          stringValue: this.api.graphqlUrl,
          description: `AppSync GraphQL URL for ${id}`,
        });
      }
    }
  }

  /** Parse Query and Mutation field names from a GraphQL schema file using the graphql parser */
  private parseSchemaFields(schemaPath: string): Array<{ typeName: string; fieldName: string }> {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    return parseSchemaFields(schema);
  }
}

/**
 * Parse Query and Mutation field names from a GraphQL schema string.
 * Uses the official `graphql` package parser instead of regex for correctness.
 */
export function parseSchemaFields(schema: string): Array<{ typeName: string; fieldName: string }> {
  let doc;
  try {
    doc = parse(schema);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse GraphQL schema: ${message}`);
  }

  const fields: Array<{ typeName: string; fieldName: string }> = [];
  visit(doc, {
    ObjectTypeDefinition(node) {
      if (node.name.value === 'Query' || node.name.value === 'Mutation') {
        const typeName = node.name.value;
        for (const field of node.fields ?? []) {
          fields.push({ typeName, fieldName: field.name.value });
        }
      }
    },
  });
  return fields;
}
