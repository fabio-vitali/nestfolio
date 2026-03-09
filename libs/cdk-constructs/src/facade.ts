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
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
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
  /** Maximum query depth allowed (default 10) */
  queryDepthLimit?: number;
  /** Enable WAF rate limiting (default true) */
  enableWaf?: boolean;
  /** WAF rate limit: max requests per 5 min per IP (default 1000) */
  wafRateLimit?: number;
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
      const depthLimit = props.queryDepthLimit ?? 10;

      this.api = new GraphqlApi(this, 'Api', {
        name: `${id}-api`,
        schema: SchemaFile.fromAsset(props.schemaPath),
        authorizationConfig: {
          defaultAuthorization: {
            authorizationType: AuthorizationType.USER_POOL,
            userPoolConfig: { userPool: props.userPool },
          },
        },
        queryDepthLimit: depthLimit,
      });
      this.graphqlUrl = this.api.graphqlUrl;

      // WAF rate limiting (S10)
      if (props.enableWaf !== false) {
        const rateLimit = props.wafRateLimit ?? 1000;

        const webAcl = new CfnWebACL(this, 'WebAcl', {
          scope: 'REGIONAL',
          defaultAction: { allow: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${id}-waf`,
            sampledRequestsEnabled: true,
          },
          rules: [
            {
              name: 'RateLimitRule',
              priority: 1,
              action: { block: {} },
              statement: {
                rateBasedStatement: {
                  limit: rateLimit,
                  aggregateKeyType: 'IP',
                },
              },
              visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: `${id}-rate-limit`,
                sampledRequestsEnabled: true,
              },
            },
          ],
        });

        new CfnWebACLAssociation(this, 'WebAclAssociation', {
          resourceArn: this.api.arn,
          webAclArn: webAcl.attrArn,
        });
      }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
