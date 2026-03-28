import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';
import { NamingService } from '@nestfolio/cdk-constructs/utils';

export class AdvisoryNarrativeCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // Knowledge Base: Explainability Feedback (S3 Vectors — managed by Bedrock)
    const kb = new KnowledgeBase(this, 'ExplainabilityKB', {
      kbName: 'explainability',
      description: 'Financial literacy content, communication templates, feedback-driven corpus',
    });

    // Ingress: trigger + feedback events
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: ['GENERATE_NARRATIVE', 'DECISION_FEEDBACK'],
    });

    // Grant KB access to the ingress handler (feedback-correlator runs inline)
    kb.bucket.grantReadWrite(ingress.handler);
    ingress.handler.addToRolePolicy(kb.triggerSyncPolicy());
    ingress.handler.addEnvironment('KB_BUCKET', kb.bucket.bucketName);
    ingress.handler.addEnvironment('KB_ID', kb.knowledgeBaseId);
    ingress.handler.addEnvironment('KB_DATA_SOURCE_ID', kb.dataSourceId);

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      state,
      publishableTypes: ['AgentInvocation', 'ReasoningOutput'],
    });

    // Model SSM params from advisory-hub
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));

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

    // AgentRuntime (no tool Lambdas — all context arrives in event payload)
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_narrative_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'explainability (Sonnet, 8192 tokens) agent with feedback loop KB',
      state,
      modelIds: [modelSonnetId],
      toolTargets: [],
    });

    this.addObservability({
      ingress,
      egress,
      monitorBedrock: true,
      bedrockModelIds: [modelSonnetId],
    });
  }
}
