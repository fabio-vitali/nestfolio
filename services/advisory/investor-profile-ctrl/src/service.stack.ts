import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { InvestorProfileEventTypes } from './domain/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';

export class InvestorProfileCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // Knowledge Base: Regulatory & Compliance (S3 Vectors — managed by Bedrock)
    const kb = new KnowledgeBase(this, 'RegulatoryKB', {
      kbName: 'regulatory',
      description: 'Regulatory frameworks, suitability rules, compliance precedents',
    });

    // Ingress: trigger event + KB ingestion events
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.ANALYZE_INVESTOR_PROFILE,
        ComplianceEventTypes.DECISION_BLOCKED,
        ComplianceEventTypes.DECISION_APPROVED,
      ],
    });

    // Egress: CDC events
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'AgentInvocation': { insert: InvestorProfileEventTypes.GOAL_INTERPRETATION_PRODUCED },
        'ReasoningOutput': { insert: InvestorProfileEventTypes.RISK_EVALUATION_PRODUCED },
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

    // Model SSM params from advisory-hub
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelOpusId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/opus'));
    const modelHaikuId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/haiku'));

    ingress.handler.addEnvironment('MODEL_OPUS_SSM', hubNaming.ssmParameterPath('models/opus'));
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
        'bedrock-agentcore:ListMemoryRecords',
        'bedrock-agentcore:ListEvents',
        'bedrock-agentcore:ListActors',
        'bedrock-agentcore:ListSessions',
      ],
      resources: ['*'],
    }));

    // AgentRuntime (no tool Lambdas for this service — RAG only)
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'investor_profile_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'user-goals (Haiku) + risk-assessment (Opus) parallel orchestration',
      state,
      modelIds: [modelOpusId, modelHaikuId],
      toolTargets: [],
      environmentVariables: {
        MODEL_OPUS_ID: modelOpusId,
        MODEL_HAIKU_ID: modelHaikuId,
        TABLE_NAME: state.getTable().tableName,
      },
    });

    this.addObservability({
      ingress,
      egress,
      extraLambdas: [kbIngestionFn],
      monitorBedrock: true,
      bedrockModelIds: [modelOpusId, modelHaikuId],
    });
  }
}
