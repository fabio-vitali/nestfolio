import { Construct } from 'constructs';
import { Annotations } from 'aws-cdk-lib';
import {
  GraphqlApi,
  SchemaFile,
  AuthorizationType,
  MappingTemplate,
  AppsyncFunction,
  Code,
  FunctionRuntime,
  Resolver,
  BaseDataSource,
} from 'aws-cdk-lib/aws-appsync';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { parse, visit } from 'graphql';

export interface JsResolverConfig {
  typeName: 'Query' | 'Mutation';
  fieldName: string;
  pipeline: string[];
  dataSource?: 'dynamodb' | 'none';
}

export interface LambdaResolverConfig {
  typeName: 'Query' | 'Mutation';
  fieldName: string;
  handler: IFunction;
}

export interface FacadeProps {
  readonly schemaPath?: string;
  readonly userPool?: IUserPool;
  readonly table?: ITable;
  readonly jsResolvers?: JsResolverConfig[];
  readonly lambdaResolvers?: LambdaResolverConfig[];
  readonly ssmPrefix?: string;
  readonly queryDepthLimit?: number;
  readonly enableWaf?: boolean;
  readonly wafRateLimit?: number;
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

      // JS pipeline resolvers
      if (props.jsResolvers?.length && props.table) {
        const ddbDs = this.api.addDynamoDbDataSource('DynamoDS', props.table);
        const noneDs = this.api.addNoneDataSource('NoneDS');

        const checkAuthFns = new Map<string, AppsyncFunction>();

        for (const resolver of props.jsResolvers) {
          const pipelineFns: AppsyncFunction[] = [];

          for (let i = 0; i < resolver.pipeline.length; i++) {
            const fnPath = resolver.pipeline[i];
            const fnName = `${resolver.typeName}${resolver.fieldName}Fn${i}`;
            const isCheckAuth = fnPath.includes('check-auth');
            const isNone = resolver.dataSource === 'none' || isCheckAuth;

            // Reuse checkAuth function per unique path
            if (isCheckAuth && checkAuthFns.has(fnPath)) {
              pipelineFns.push(checkAuthFns.get(fnPath)!);
              continue;
            }

            const fn = new AppsyncFunction(this, fnName, {
              name: fnName,
              api: this.api,
              dataSource: isNone ? noneDs : ddbDs,
              code: Code.fromAsset(fnPath),
              runtime: FunctionRuntime.JS_1_0_0,
            });

            if (isCheckAuth) checkAuthFns.set(fnPath, fn);
            pipelineFns.push(fn);
          }

          const tableName = props.table.tableName;
          new Resolver(this, `${resolver.typeName}${resolver.fieldName}Resolver`, {
            api: this.api,
            typeName: resolver.typeName,
            fieldName: resolver.fieldName,
            code: Code.fromInline(`
              export function request(ctx) {
                ctx.stash.tableName = '${tableName}';
                return {};
              }
              export function response(ctx) {
                return ctx.prev.result;
              }
            `),
            runtime: FunctionRuntime.JS_1_0_0,
            pipelineConfig: pipelineFns,
          });
        }
      }

      // Lambda resolvers
      if (props.lambdaResolvers?.length) {
        const lambdaDsMap = new Map<string, BaseDataSource>();
        for (const resolver of props.lambdaResolvers) {
          const fnArn = resolver.handler.functionArn;
          if (!lambdaDsMap.has(fnArn)) {
            lambdaDsMap.set(
              fnArn,
              this.api.addLambdaDataSource(`LambdaDS${lambdaDsMap.size}`, resolver.handler),
            );
          }
          const ds = lambdaDsMap.get(fnArn)!;
          ds.createResolver(`${resolver.typeName}${resolver.fieldName}Resolver`, {
            typeName: resolver.typeName,
            fieldName: resolver.fieldName,
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
