import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { NarrativeEventTypes } from './domain/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import {
  AgentRuntime, KnowledgeBase,
  BedrockUsageAlarms, importCostAlertTopic,
} from '@nestfolio/cdk-constructs/extensions';
import { agentProfile, NamingService, PARAMS_AND_SECRETS_LAYER } from '@nestfolio/cdk-constructs/utils';
import { AGENT_BUDGETS } from '@nestfolio/decision-workflow-ctrl/agent-budgets';

export class AdvisoryNarrativeCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // Knowledge Base: Explainability Feedback (S3 Vectors — managed by Bedrock)
    const kb = new KnowledgeBase(this, 'ExplainabilityKB', {
      kbName: 'explainability',
      description: 'Financial literacy content, communication templates, feedback-driven corpus',
    });

    // Ingress: trigger + feedback events.
    // Uses agentProfile() because this is one of the two per-cycle deadline-bound
    // agent calls. agentLatencyP90Ms=35_000 (raised from observed p90=29.7s to
    // cover p99=53.7s — see spec §10 OQ #2 + plan decision #2).
    const ingress = new Ingress(this, 'Ingress', {
      state,
      profile: agentProfile({
        agentLatencyP90Ms: 35_000,
        expectedBurstSize: 40,
        uxBudgetSeconds: AGENT_BUDGETS.ADVISORY_NARRATIVE_UX_SEC,
      }),
      eventTypes: [
        DecisionWorkflowEventTypes.GENERATE_NARRATIVE,
        DecisionWorkflowEventTypes.DECISION_FEEDBACK,
      ],
      lambdaProps: {
        paramsAndSecrets: PARAMS_AND_SECRETS_LAYER,
      },
    });

    // Grant KB access to the ingress handler (feedback-correlator runs inline)
    kb.bucket.grantReadWrite(ingress.handler);
    ingress.handler.addToRolePolicy(kb.triggerSyncPolicy());
    ingress.handler.addEnvironment('KB_BUCKET', kb.bucket.bucketName);
    ingress.handler.addEnvironment('KB_ID', kb.knowledgeBaseId);
    ingress.handler.addEnvironment('KB_DATA_SOURCE_ID', kb.dataSourceId);

    // Egress: CDC events.
    //
    // Post advisory-cycle-agent-precomputation Task 7: the handler emits
    // AgentCompletion / AgentFailure rows instead of resuming a SF callback
    // directly. The Egress maps those rows to NARRATIVE_COMPLETED /
    // NARRATIVE_FAILED, which DWC's CallbackIngress (Task 10) consumes to call
    // states:SendTaskSuccess / states:SendTaskFailure.
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'ReasoningOutput': { insert: NarrativeEventTypes.EXPLANATION_GENERATED },
        'AgentCompletion': { insert: NarrativeEventTypes.NARRATIVE_COMPLETED },
        'AgentFailure':    { insert: NarrativeEventTypes.NARRATIVE_FAILED },
      },
    });

    // Model SSM params from advisory-hub
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelHaikuId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/haiku'));

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

    // AgentRuntime (no tool Lambdas — all context arrives in event payload)
    const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_narrative_agents',
      agentCodePath: join(__dirname, '..', 'agents', 'advisory-narrative'),
      description: 'explainability (Haiku 4.5, 8192 tokens) agent with feedback loop KB',
      state,
      modelIds: [modelHaikuId],
      toolTargets: [],
      environmentVariables: {
        MODEL_HAIKU_ID: modelHaikuId,
        TABLE_NAME: state.getTable().tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        MEMORY_ID: memoryId,
      },
    });

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

    // SSM-published runtime target. Defaults to the real AgentCore runtime ARN;
    // integration tests redirect via SsmOverrideFixture to a Function URL.
    const runtimeArn = agentRuntime.runtime.agentRuntimeArn;
    const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
      parameterName: `/nestfolio/${props.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`,
      stringValue: runtimeArn,
    });
    ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
    agentRuntimeUrlParam.grantRead(ingress.handler);

    // Grant the ingress handler permission to invoke the AgentCore runtime
    // (covers both runtime ARN and its endpoint sub-resource).
    agentRuntime.grantInvoke(ingress.handler);

    // NOTE: No states:SendTask* grants. Post advisory-cycle-agent-precomputation,
    // the handler uses materializeToTable and emits AgentCompletion/AgentFailure
    // CDC rows. DWC's CallbackIngress consumes the resulting NARRATIVE_COMPLETED
    // / NARRATIVE_FAILED events and owns the states:SendTask* IAM grants. The
    // full callback-IAM lockdown is asserted workspace-wide by Task 12's
    // invariant test.

    // Grant the AgentRuntime role permission to emit trace envelopes to the
    // advisory bus (consumed by e2e AgentTraceTrap and contract test assertions).
    this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);

    this.addObservability({
      ingress,
      egress,
      monitorBedrock: true,
      bedrockModelIds: [modelHaikuId],
    });

    // Per-service Bedrock usage alarms (P1 — 2026-04-28 cost safeguards).
    new BedrockUsageAlarms(this, 'BedrockAlarms', {
      serviceName: 'advisory-narrative-ctrl',
      modelIds: [modelHaikuId],
      alertTopic: importCostAlertTopic(
        this, 'CostAlertTopic',
        `/nestfolio/${props.prefix}-investor/cost-controls/alertTopicArn`,
      ),
    });
  }
}
