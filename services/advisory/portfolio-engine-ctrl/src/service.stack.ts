import { Duration } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { PortfolioEngineEventTypes } from './domain/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { SecEdgarAdptEventTypes } from '@nestfolio/sec-edgar-adpt/events';
import {
  AgentRuntime, KnowledgeBase,
  BedrockUsageAlarms, importCostAlertTopic,
} from '@nestfolio/cdk-constructs/extensions';
import { agentProfile, defaultLambdaProps, NamingService, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
import { AGENT_BUDGETS } from '@nestfolio/decision-workflow-ctrl/agent-budgets';

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
    // Uses agentProfile() because this is one of the two per-cycle deadline-bound
    // agent calls — see docs/superpowers/specs/2026-05-18-agent-pipeline-backlog-trap-architectural-design.md.
    // The helper derives Lambda timeout, SQS concurrency and visibility timeout
    // from p90 latency, expected burst size, and the SF UX budget; the synth
    // fails loud if the three drift apart.
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.CONSTRUCT_PORTFOLIO,
        SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
        SecEdgarAdptEventTypes.SEC_10K_UPDATED,
      ],
      profile: agentProfile({
        agentLatencyP90Ms: 29_000,
        expectedBurstSize: 5,
        uxBudgetSeconds: AGENT_BUDGETS.PORTFOLIO_ENGINE_UX_SEC,
      }),
      lambdaProps: {
        paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      },
      reservedConcurrency: 1,
    });

    // Egress: CDC events.
    //
    // Post advisory-cycle-agent-precomputation Task 6: the handler emits
    // AgentCompletion / AgentFailure rows instead of resuming a SF callback
    // directly. The Egress maps those rows to PORTFOLIO_COMPLETED /
    // PORTFOLIO_FAILED, which DWC's CallbackIngress (Task 10) consumes to call
    // states:SendTaskSuccess / states:SendTaskFailure.
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'AgentInvocation': { insert: PortfolioEngineEventTypes.PORTFOLIO_CONSTRUCTION_PROPOSED },
        'ReasoningOutput': { insert: PortfolioEngineEventTypes.REBALANCE_PLAN_PRODUCED },
        'AgentCompletion': { insert: PortfolioEngineEventTypes.PORTFOLIO_COMPLETED },
        'AgentFailure':    { insert: PortfolioEngineEventTypes.PORTFOLIO_FAILED },
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
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        MEMORY_ID: memoryId,
      },
      idleTimeout: Duration.minutes(2),
      maxLifetime: Duration.minutes(30),
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

    // Grant the AgentRuntime role permission to emit trace envelopes to the advisory bus.
    this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);

    // Grant the AgentRuntime role AgentCore Memory read permissions
    // (long-term memory retrieval via searchLongTermMemory).
    agentRuntime.runtime.grantPrincipal.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateEvent',
        'bedrock-agentcore:RetrieveMemoryRecords',
        'bedrock-agentcore:GetMemoryRecord',
        'bedrock-agentcore:ListEvents',
        'bedrock-agentcore:ListActors',
        'bedrock-agentcore:ListSessions',
      ],
      resources: ['*'],
    }));

    // NOTE: No states:SendTask* grants. Post advisory-cycle-agent-precomputation,
    // the handler uses materializeToTable and emits AgentCompletion/AgentFailure
    // CDC rows. DWC's CallbackIngress consumes the resulting PORTFOLIO_COMPLETED
    // / PORTFOLIO_FAILED events and owns the states:SendTask* IAM grants. The
    // full callback-IAM lockdown is asserted workspace-wide by Task 12's
    // invariant test.

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [kbIngestionFn],
      monitorBedrock: true,
      bedrockModelIds: [modelOpusId, modelSonnetId],
    });

    // Per-service Bedrock usage alarms (P1 — 2026-04-28 cost safeguards).
    new BedrockUsageAlarms(this, 'BedrockAlarms', {
      serviceName: 'portfolio-engine-ctrl',
      modelIds: [modelOpusId, modelSonnetId],
      alertTopic: importCostAlertTopic(
        this, 'CostAlertTopic',
        `/nestfolio/${props.prefix}-investor/cost-controls/alertTopicArn`,
      ),
    });
  }
}
