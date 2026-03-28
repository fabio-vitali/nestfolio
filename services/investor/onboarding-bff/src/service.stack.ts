import * as path from 'path';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { ServiceStack, ServiceStackProps, State, Egress } from '@nestfolio/cdk-constructs/core';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';

export class OnboardingBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // Egress — CDC for ONBOARDING_COMPLETED and GO_LIVE_CONFIRMED
    new Egress(this, 'Egress', {
      state,
      publishableTypes: ['OnboardingCompleted', 'GoLiveConfirmed'],
    });

    // Model IDs from SSM (shared with advisory services)
    const sonnetModelId = StringParameter.valueForStringParameter(
      this, `/${props.prefix}/advisory-hub/sonnet-model-id`,
    );

    // Knowledge Base for product documentation RAG
    const knowledgeBase = new KnowledgeBase(this, 'OnboardingKB', {
      kbName: 'nestfolio-docs',
      description: 'Nestfolio product documentation for onboarding agent',
    });

    // Lambda handler for RAG search tool
    const searchKbFn = new NodejsFunction(this, 'SearchKbFn', {
      entry: path.join(__dirname, 'agent/tools/search-kb.handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
      },
    });

    searchKbFn.addToRolePolicy(knowledgeBase.triggerSyncPolicy());

    // AgentRuntime — uses own table
    new AgentRuntime(this, 'OnboardingAgent', {
      runtimeName: 'onboarding-agent',
      agentCodePath: path.join(__dirname, '..'),
      description: 'Conversational onboarding agent for investor onboarding',
      modelIds: [sonnetModelId],
      state,
      toolTargets: [{
        name: 'search_knowledge_base',
        description: 'Search Nestfolio documentation to answer user questions',
        handler: searchKbFn,
        schemaPath: path.join(__dirname, 'agent/tools/search-kb.schema.json'),
      }],
      environmentVariables: {
        TABLE_NAME: state.getTable().tableName,
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        AGENT_RUNTIME: 'true',
      },
    });
  }
}
