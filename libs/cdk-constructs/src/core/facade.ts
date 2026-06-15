import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildSync } from 'esbuild';
import { Construct } from 'constructs';
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
  CfnGraphQLApi,
  FieldLogLevel,
} from 'aws-cdk-lib/aws-appsync';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IUserPool, UserPool } from 'aws-cdk-lib/aws-cognito';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { parse, visit } from 'graphql';
import { ServiceStack } from './service-stack';
import { State } from './state';

/**
 * Load resolver code for an AppSync JS function file.
 *
 * Accepts the full path to a `.fn.js` file. If a `.fn.ts` sibling with the same
 * base name exists, esbuild bundles it (inlining local imports, keeping
 * `@aws-appsync/utils` as an external — it is provided by the APPSYNC_JS runtime).
 * Falls back to reading the `.fn.js` file as plain text when no `.fn.ts` exists,
 * preserving the exact existing behaviour for all current resolvers.
 *
 * @param jsFnPath Full path to the `.fn.js` file (e.g. `/…/graphql/js-function/my-resolver.fn.js`).
 * @returns Resolver source code as a string ready to pass to `Code.fromInline()`.
 */
export function loadResolverCode(jsFnPath: string): string {
  const tsPath = jsFnPath.replace(/\.fn\.js$/, '.fn.ts');
  if (existsSync(tsPath)) {
    const result = buildSync({
      entryPoints: [tsPath],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2020',
      platform: 'neutral',
      external: ['@aws-appsync/utils'],
      legalComments: 'none',
    });
    return result.outputFiles[0].text;
  }
  return readFileSync(jsFnPath, 'utf-8');
}

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
  /** State construct for DynamoDB data source. Optional — Facades with only Lambda resolvers don't need it. */
  readonly state?: State;
  readonly schemaPath?: string;
  readonly userPool?: IUserPool;
  readonly userPoolSsmPath?: string;
  readonly jsResolvers?: JsResolverConfig[];
  readonly lambdaResolvers?: LambdaResolverConfig[];
  readonly queryDepthLimit?: number;
  readonly enableWaf?: boolean;
  readonly wafRateLimit?: number;
  /** When true, adds IAM as an additional authorization mode alongside Cognito User Pool. Required for Lambda-to-AppSync mutations using @aws_iam directives. */
  readonly enableIamAuth?: boolean;
  /** When set, enables AppSync field-level logging at the given level. Logs flow to a default CloudWatch role/log group provisioned by CDK. */
  readonly fieldLogLevel?: FieldLogLevel;
}

export class Facade extends Construct {
  readonly api?: GraphqlApi;
  readonly graphqlUrl?: string;

  constructor(scope: Construct, id: string, props: FacadeProps) {
    super(scope, id);

    const serviceStack = ServiceStack.of(this);
    const { naming, serviceDir } = serviceStack;
    const state = props.state;

    // If no resolvers at all, skip API creation
    if (!props.jsResolvers?.length && !props.lambdaResolvers?.length) {
      return;
    }

    const schemaPath = props.schemaPath ?? join(serviceDir, 'schema.graphql');

    // Resolve user pool: explicit > SSM lookup > default SSM path
    let userPool = props.userPool;
    if (!userPool) {
      const ssmPath = props.userPoolSsmPath ?? naming.ssmParameterPath('auth/userPoolId');
      const userPoolId = StringParameter.valueForStringParameter(this, ssmPath);
      userPool = UserPool.fromUserPoolId(this, 'UserPool', userPoolId);
    }

    const depthLimit = props.queryDepthLimit ?? 10;

    this.api = new GraphqlApi(this, 'Api', {
      name: `${id}-api`,
      schema: SchemaFile.fromAsset(schemaPath),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
        additionalAuthorizationModes: props.enableIamAuth
          ? [{ authorizationType: AuthorizationType.IAM }]
          : undefined,
      },
      queryDepthLimit: depthLimit,
      ...(props.fieldLogLevel !== undefined
        ? { logConfig: { fieldLogLevel: props.fieldLogLevel } }
        : {}),
    });
    this.graphqlUrl = this.api.graphqlUrl;

    // WAF rate limiting — driven by pipeline config (waf flag on ServiceStack)
    if (props.enableWaf ?? serviceStack.waf) {
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
    if (props.jsResolvers?.length && state?.table) {
      const ddbDs = this.api.addDynamoDbDataSource('DynamoDS', state.getTable());
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

          // Use esbuild bundling when a .fn.ts sibling exists; keep Code.fromAsset for plain .fn.js files.
          const tsSiblingPath = fnPath.replace(/\.fn\.js$/, '.fn.ts');
          const resolverCode = existsSync(tsSiblingPath)
            ? Code.fromInline(loadResolverCode(fnPath))
            : Code.fromAsset(fnPath);

          const fn = new AppsyncFunction(this, fnName, {
            name: fnName,
            api: this.api,
            dataSource: isNone ? noneDs : ddbDs,
            code: resolverCode,
            runtime: FunctionRuntime.JS_1_0_0,
          });

          if (isCheckAuth) checkAuthFns.set(fnPath, fn);
          pipelineFns.push(fn);
        }

        const tableName = state.getTable().tableName;
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

    // Store API URLs in SSM
    if (this.api) {
      new StringParameter(this, 'ApiUrlParam', {
        parameterName: naming.ssmServicePath('api/graphqlUrl'),
        stringValue: this.api.graphqlUrl,
        description: `AppSync GraphQL URL for ${id}`,
      });
      const cfnApi = this.api.node.defaultChild as CfnGraphQLApi;
      new StringParameter(this, 'ApiRealtimeUrlParam', {
        parameterName: naming.ssmServicePath('api/realtimeUrl'),
        stringValue: cfnApi.attrRealtimeUrl,
        description: `AppSync realtime (WSS) URL for ${id}`,
      });
      new StringParameter(this, 'ApiIdParam', {
        parameterName: naming.ssmServicePath('api/apiId'),
        stringValue: this.api.apiId,
        description: `AppSync API id for ${id}`,
      });
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

/**
 * Auto-discover JS pipeline resolver configs from a GraphQL schema and service directory.
 * Reads the schema at CDK synth time to enumerate Query/Mutation fields,
 * then maps each field to a pipeline of JS function files.
 */
export function discoverJsResolvers(serviceDir: string, options?: {
  /** Fields that use 'none' data source */
  noneDataSource?: string[];
  /** Fields with extra pipeline steps (e.g. readback) appended AFTER the main resolver */
  extraSteps?: Record<string, string[]>;
  /** Steps inserted AFTER check-auth but BEFORE the main resolver (e.g. feature flag checks) */
  preSteps?: Record<string, string[]>;
  /** Fields handled by lambdaResolvers (excluded from JS resolvers) */
  exclude?: string[];
}): JsResolverConfig[] {
  const schemaPath = join(serviceDir, 'schema.graphql');
  const schemaContent = readFileSync(schemaPath, 'utf-8');
  const fields = parseSchemaFields(schemaContent);

  const excludeSet = new Set(options?.exclude ?? []);
  const noneSet = new Set(options?.noneDataSource ?? []);
  const jsFnPath = join(serviceDir, 'graphql', 'js-function');
  const checkAuthPath = join(jsFnPath, 'utils', 'check-auth.fn.js');

  return fields
    .filter(f => !excludeSet.has(f.fieldName))
    .map(f => {
      const fnFileName = toKebabCase(f.fieldName) + '.fn.js';
      const pipeline = [checkAuthPath];

      // Pre-steps: after auth, before main resolver (e.g. feature flag checks)
      if (options?.preSteps?.[f.fieldName]) {
        pipeline.push(...options.preSteps[f.fieldName].map(step => join(jsFnPath, step)));
      }

      pipeline.push(join(jsFnPath, fnFileName));

      // Post-steps: after main resolver (e.g. readback)
      if (options?.extraSteps?.[f.fieldName]) {
        pipeline.push(...options.extraSteps[f.fieldName].map(step => join(jsFnPath, step)));
      }

      return {
        typeName: f.typeName as 'Query' | 'Mutation',
        fieldName: f.fieldName,
        pipeline,
        ...(noneSet.has(f.fieldName) ? { dataSource: 'none' as const } : {}),
      };
    });
}

function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}
