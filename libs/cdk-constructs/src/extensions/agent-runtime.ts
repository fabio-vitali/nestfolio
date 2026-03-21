import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';

export interface ToolTarget {
  name: string;
  description: string;
  handler: IFunction;
  schemaPath: string;
}

export interface AgentRuntimeProps {
  /** Name for the AgentCore Runtime */
  runtimeName: string;
  /** Path to the agent code asset (directory with Dockerfile for AgentCore container) */
  agentCodePath: string;
  /** Description of the runtime */
  description?: string;
  /** Cognito User Pool for runtime authentication */
  userPool?: IUserPool;
  /** Cognito User Pool Clients */
  userPoolClients?: IUserPoolClient[];
  /** Environment variables for the runtime */
  environmentVariables?: Record<string, string>;
  /** Tool targets for the Gateway (MCP protocol) */
  toolTargets?: ToolTarget[];
  /** DynamoDB tables to grant access to */
  tables?: ITable[];
  /** Bedrock model IDs to grant invoke access */
  modelIds?: string[];
  /** Idle timeout for runtime sessions */
  idleTimeout?: Duration;
  /** Max lifetime for runtime */
  maxLifetime?: Duration;
}

/**
 * AgentRuntime construct -- wraps AgentCore Runtime + Gateway into a single construct.
 *
 * Provisions a Bedrock AgentCore Runtime (container-based) with optional MCP Gateway
 * for tool access. Grants Bedrock model invoke and DynamoDB access automatically.
 */
export class AgentRuntime extends Construct {
  readonly runtime: agentcore.Runtime;
  readonly gateway?: agentcore.Gateway;

  constructor(scope: Construct, id: string, props: AgentRuntimeProps) {
    super(scope, id);

    // Create Runtime (container-based -- requires Dockerfile in agentCodePath)
    this.runtime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName: props.runtimeName,
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(props.agentCodePath),
      description: props.description,
      ...(props.userPool && props.userPoolClients
        ? {
            authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
              props.userPool,
              props.userPoolClients,
            ),
          }
        : {}),
      environmentVariables: props.environmentVariables,
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: props.idleTimeout ?? Duration.minutes(15),
        maxLifetime: props.maxLifetime ?? Duration.hours(4),
      },
    });

    // Grant Bedrock model access
    for (const modelId of props.modelIds ?? []) {
      this.runtime.grantPrincipal.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: [`arn:aws:bedrock:*::foundation-model/${modelId}`],
        }),
      );
    }

    // Grant DynamoDB table access
    for (const table of props.tables ?? []) {
      table.grantReadWriteData(this.runtime);
    }

    // Create Gateway with tool targets
    if (props.toolTargets && props.toolTargets.length > 0) {
      this.gateway = new agentcore.Gateway(this, 'Gateway', {
        gatewayName: `${props.runtimeName}-tools`,
        protocolConfiguration: new agentcore.McpProtocolConfiguration({
          instructions: `Tools for ${props.runtimeName}`,
          searchType: agentcore.McpGatewaySearchType.SEMANTIC,
        }),
        authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
      });

      for (const tool of props.toolTargets) {
        this.gateway.addLambdaTarget(tool.name, {
          gatewayTargetName: tool.name,
          description: tool.description,
          lambdaFunction: tool.handler,
          toolSchema: agentcore.ToolSchema.fromLocalAsset(tool.schemaPath),
        });
      }

      this.gateway.grantInvoke(this.runtime);
    }
  }
}
