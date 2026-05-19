import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { State } from '../core/state';
import { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as fs from 'fs';

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
  /** State construct for DynamoDB/S3 grants. Optional — not all agents need state access. */
  state?: State;
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
      environmentVariables: { ...props.environmentVariables },
      lifecycleConfiguration: {
        idleRuntimeSessionTimeout: props.idleTimeout ?? Duration.minutes(15),
        maxLifetime: props.maxLifetime ?? Duration.hours(4),
      },
    });

    // Grant Bedrock model access. Cross-region inference profile IDs (us.* /
    // global.*) require permission on BOTH the profile resource and the
    // underlying foundation model across all regions the profile routes to.
    for (const modelId of props.modelIds ?? []) {
      this.runtime.grantPrincipal.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: buildBedrockModelResources(modelId),
        }),
      );
    }

    // Grant State access (DynamoDB + S3)
    if (props.state?.table) {
      props.state.getTable().grantReadWriteData(this.runtime);
    }
    if (props.state?.bucket) {
      props.state.getBucket().grantReadWrite(this.runtime);
    }

    // Create Gateway with tool targets
    if (props.toolTargets && props.toolTargets.length > 0) {
      this.gateway = new agentcore.Gateway(this, 'Gateway', {
        gatewayName: `${props.runtimeName.replace(/_/g, '-')}-tools`,
        protocolConfiguration: new agentcore.McpProtocolConfiguration({
          instructions: `Tools for ${props.runtimeName}`,
          searchType: agentcore.McpGatewaySearchType.SEMANTIC,
        }),
        authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
      });

      for (const tool of props.toolTargets) {
        const sanitizedName = tool.name.replace(/_/g, '-');
        // Read schema file and wrap in MCP ToolDefinition format
        const inputSchema = JSON.parse(fs.readFileSync(tool.schemaPath, 'utf-8'));
        this.gateway.addLambdaTarget(sanitizedName, {
          gatewayTargetName: sanitizedName,
          description: tool.description,
          lambdaFunction: tool.handler,
          toolSchema: agentcore.ToolSchema.fromInline([{
            name: tool.name,
            description: tool.description,
            inputSchema,
          }]),
        });
      }

      this.gateway.grantInvoke(this.runtime);
    }
  }

  /**
   * Grant a Lambda (or any IAM grantable) permission to call
   * bedrock-agentcore:InvokeAgentRuntime on both the runtime ARN and ALL its
   * endpoint ARNs. The runtime ARN alone is insufficient — at invoke time the
   * SDK targets the endpoint resource (e.g. .../runtime-endpoint/DEFAULT).
   */
  grantInvoke(grantee: iam.IGrantable): void {
    const runtimeArn = this.runtime.agentRuntimeArn;
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [runtimeArn, `${runtimeArn}/runtime-endpoint/*`],
      }),
    );
  }
}

/**
 * Build the Bedrock resource ARNs for a model id. Consumers commonly pass
 * SSM deploy-time tokens (advisory-hub stores cross-region inference profile
 * ids like "us.anthropic.claude-opus-4-6-v1"), so we can't branch on the
 * literal value at synth time. Unconditionally grant permission on:
 *   1. The inference-profile ARN keyed by the (possibly-prefixed) model id.
 *   2. All foundation-model ARNs — a cross-region inference profile routes
 *      to the underlying base model across multiple regions, so scoping to a
 *      single-region foundation-model ARN would break routing. `foundation-
 *      model/*` is an acceptable compromise: the resource type is already
 *      scoped, and the profile grant above is the tight half of the pair.
 * Base-model-only consumers (no us./global. prefix) will have a profile ARN
 * that never matches — harmless; the foundation-model wildcard covers them.
 */
function buildBedrockModelResources(modelId: string): string[] {
  return [
    `arn:aws:bedrock:*:*:inference-profile/${modelId}`,
    `arn:aws:bedrock:*::foundation-model/*`,
  ];
}
