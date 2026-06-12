import { Duration } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { InvestorProfileEventTypes } from './domain/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
import {
  AgentRuntime, KnowledgeBase,
  BedrockUsageAlarms, importCostAlertTopic,
} from '@nestfolio/cdk-constructs/extensions';
import { agentProps, defaultLambdaProps, NamingService, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';

export class InvestorProfileCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // Knowledge Base: Regulatory & Compliance (S3 Vectors — managed by Bedrock)
    const kb = new KnowledgeBase(this, 'RegulatoryKB', {
      kbName: 'regulatory',
      description: 'Regulatory frameworks, suitability rules, compliance precedents',
    });

    // Ingress: continuous-projection triggers + KB ingestion events.
    // Subscribes to investor-domain mutations that drive InvestorProfileSnapshot
    // materialization (Task 3 of advisory-cycle-agent-precomputation). Uses
    // agentProps (1024 MB / batchSize 1 / concurrency 5) for the Bedrock
    // dispatch, but overrides the timing knobs: this is a continuous-projection
    // writer with NO production deadline (it resumes no SF task token), so the
    // Lambda timeout is matched to the agent p99 (~90s) and the SQS visibility
    // timeout is tuned so a maxVms-driven native redrive lands ~4min after a
    // failure. See docs/superpowers/specs/2026-05-21-agentcore-invocation-resilience-design.md
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        InvestorCrossDomainEventTypes.INVESTOR_PROFILE_UPDATED,
        InvestorCrossDomainEventTypes.MANDATE_ISSUED,
        ComplianceEventTypes.DECISION_BLOCKED,
        ComplianceEventTypes.DECISION_APPROVED,
      ],
      profile: agentProps,
      lambdaTimeout: Duration.seconds(150),
      visibilityTimeout: Duration.seconds(240),
      lambdaProps: {
        paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      },
    });

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'InvestorProfileSnapshot': {
          insert: InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_CREATED,
          modify: InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_UPDATED,
        },
      },
    });

    // KB ingestion Lambda (separate from event-listener)
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

    // Model SSM params from advisory-hub.
    // risk-assessment flipped from Opus → Sonnet 4.6 in Lever C of bedrock-cost-
    // reduction-may-2026 (2026-05-17). user-goals stays on Haiku. The Opus
    // model is no longer used by this service, so its IAM grant + env var
    // were removed (Lever C IAM hardening, 2026-05-18 — first deploy of Lever
    // C failed with AccessDeniedException because Sonnet was not granted).
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));
    const modelHaikuId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/haiku'));

    ingress.handler.addEnvironment('MODEL_SONNET_SSM', hubNaming.ssmParameterPath('models/sonnet'));
    ingress.handler.addEnvironment('MODEL_HAIKU_SSM', hubNaming.ssmParameterPath('models/haiku'));

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

    // AgentRuntime (no tool Lambdas for this service — RAG only)
    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'investor_profile_agents',
      agentCodePath: join(__dirname, '..', 'agents', 'investor-profile'),
      description: 'user-goals (Haiku) + risk-assessment (Sonnet 4.6) parallel orchestration',
      state,
      modelIds: [modelSonnetId, modelHaikuId],
      toolTargets: [],
      environmentVariables: {
        MODEL_SONNET_ID: modelSonnetId,
        MODEL_HAIKU_ID: modelHaikuId,
        TABLE_NAME: state.getTable().tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        MEMORY_ID: memoryId,
      },
      // Tightened from construct defaults (15 min / 4 h) — headless burst
      // sessions; idle sits below the 240 s SQS-redrive window so quota frees
      // before redrive (see agentcore-maxvms-browser-path-resilience spec).
      idleTimeout: Duration.minutes(2),
      maxLifetime: Duration.minutes(30),
    });

    // Grant the AgentRuntime role permission to emit trace envelopes to the
    // advisory bus (consumed by AgentTraceTrap in e2e feature tests).
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

    const runtimeArn = agentRuntime.runtime.agentRuntimeArn;
    const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
      parameterName: `/nestfolio/${props.prefix}-investor-profile-ctrl/agent/runtimeUrl`,
      stringValue: runtimeArn,
    });
    ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
    agentRuntimeUrlParam.grantRead(ingress.handler);

    // Grants InvokeAgentRuntime on both the runtime ARN and its endpoint ARNs
    // (at invoke time the SDK targets .../runtime-endpoint/DEFAULT).
    agentRuntime.grantInvoke(ingress.handler);

    // NOTE: No states:SendTask* grants. Post advisory-cycle-agent-precomputation,
    // the handler uses materializeToTable (continuous projection) and no longer
    // resumes a per-cycle SF callback. The full callback-IAM lockdown is asserted
    // workspace-wide by Task 12's invariant test.

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [kbIngestionFn],
      monitorBedrock: true,
      bedrockModelIds: [modelSonnetId, modelHaikuId],
    });

    // Per-service Bedrock usage alarms (P1 — 2026-04-28 cost safeguards).
    new BedrockUsageAlarms(this, 'BedrockAlarms', {
      serviceName: 'investor-profile-ctrl',
      modelIds: [modelSonnetId, modelHaikuId],
      alertTopic: importCostAlertTopic(
        this, 'CostAlertTopic',
        `/nestfolio/${props.prefix}-investor/cost-controls/alertTopicArn`,
      ),
    });
  }
}
