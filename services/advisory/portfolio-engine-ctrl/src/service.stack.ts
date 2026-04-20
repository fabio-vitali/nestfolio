import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { PortfolioEngineEventTypes } from './domain/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { SecEdgarAdptEventTypes } from '@nestfolio/sec-edgar-adpt/events';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';
import { agentProps, defaultLambdaProps, NamingService, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';

export class PortfolioEngineCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // Knowledge Base: Fund & Instrument (S3 Vectors — managed by Bedrock)
    const kb = new KnowledgeBase(this, 'FundKB', {
      kbName: 'fund',
      description: 'ETF prospectuses, risk factors, instrument data, allocation history',
    });

    // Ingress: trigger + KB ingestion events.
    // Uses agentProps because the handler dispatches to Bedrock (Opus + Sonnet) —
    // 1024 MB / 5min timeout / batchSize 1 / concurrency capped at 5.
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.CONSTRUCT_PORTFOLIO,
        SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
        SecEdgarAdptEventTypes.SEC_10K_UPDATED,
      ],
      profile: agentProps,
      lambdaProps: {
        paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      },
    });

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'AgentInvocation': { insert: PortfolioEngineEventTypes.PORTFOLIO_CONSTRUCTION_PROPOSED },
        'ReasoningOutput': { insert: PortfolioEngineEventTypes.REBALANCE_PLAN_PRODUCED },
      },
    });

    // KB ingestion Lambda
    const kbIngestionFn = new NodejsFunction(this, 'KBIngestion', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'kb-ingestion-handler.ts'),
      environment: {
        KB_BUCKET: kb.bucket.bucketName,
        KB_ID: kb.knowledgeBaseId,
        KB_DATA_SOURCE_ID: kb.dataSourceId,
        TABLE_NAME: state.getTable().tableName,
        BUS_NAME: this.eventBus.eventBusName,
      },
    });
    kb.bucket.grantWrite(kbIngestionFn);
    kbIngestionFn.addToRolePolicy(kb.triggerSyncPolicy());


    // Model SSM params from advisory-hub
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelOpusId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/opus'));
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));

    ingress.handler.addEnvironment('MODEL_OPUS_SSM', hubNaming.ssmParameterPath('models/opus'));
    ingress.handler.addEnvironment('MODEL_SONNET_SSM', hubNaming.ssmParameterPath('models/sonnet'));

    // Memory ID from decision-workflow-ctrl SSM
    const workflowNaming = new NamingService({
      prefix: props.prefix, subsystem: 'advisory', service: 'decision-workflow-ctrl',
    });
    const memoryId = StringParameter.valueForStringParameter(
      this, workflowNaming.ssmParameterPath('memory/id'),
    );
    ingress.handler.addEnvironment('MEMORY_ID', memoryId);

    // IAM grants for Memory API
    ingress.handler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateEvent',
        'bedrock-agentcore:RetrieveMemoryRecords',
        'bedrock-agentcore:GetMemoryRecord',
        'bedrock-agentcore:ListMemoryRecords',
        'bedrock-agentcore:ListEvents',
        'bedrock-agentcore:ListActors',
        'bedrock-agentcore:ListSessions',
      ],
      resources: ['*'],
    }));

    // AgentRuntime
    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'portfolio_engine_agents',
      agentCodePath: join(__dirname, '..', 'agents', 'portfolio-engine'),
      description: 'portfolio-construction (Opus) + rebalance-planner (Sonnet) parallel orchestration',
      state,
      modelIds: [modelOpusId, modelSonnetId],
      toolTargets: [],
      environmentVariables: {
        MODEL_OPUS_ID: modelOpusId,
        MODEL_SONNET_ID: modelSonnetId,
        TABLE_NAME: state.getTable().tableName,
      },
    });

    // SSM-published runtime target. Defaults to the real AgentCore runtime ARN;
    // integration tests redirect via SsmOverrideFixture to a Function URL.
    const runtimeArn = agentRuntime.runtime.agentRuntimeArn;
    const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
      parameterName: `/nestfolio/${props.prefix}-portfolio-engine-ctrl/agent/runtimeUrl`,
      stringValue: runtimeArn,
    });
    ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
    agentRuntimeUrlParam.grantRead(ingress.handler);

    // Grant the ingress handler permission to invoke the AgentCore runtime
    // (covers both runtime ARN and its endpoint sub-resource).
    agentRuntime.grantInvoke(ingress.handler);

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [kbIngestionFn],
      monitorBedrock: true,
      bedrockModelIds: [modelOpusId, modelSonnetId],
    });
  }
}
