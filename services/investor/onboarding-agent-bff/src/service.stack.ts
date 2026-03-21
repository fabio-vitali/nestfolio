import * as path from 'path';
import { Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { ServiceStack, ServiceStackProps } from '@nestfolio/cdk-constructs/core';
import { AgentRuntime, KnowledgeBase } from '@nestfolio/cdk-constructs/extensions';

export class OnboardingAgentBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    // Reuse investor-bff's DDB table (looked up via SSM)
    const tableName = StringParameter.valueForStringParameter(
      this, `/${props.prefix}/investor-hub/table-name`,
    );
    const investorTable = Table.fromTableName(this, 'InvestorTable', tableName);

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

    // Grant KB access to the Lambda
    searchKbFn.addToRolePolicy(knowledgeBase.triggerSyncPolicy());

    // AgentCore Runtime
    new AgentRuntime(this, 'OnboardingAgent', {
      runtimeName: 'onboarding-agent',
      agentCodePath: path.join(__dirname, '..'),
      description: 'Conversational onboarding agent for investor onboarding',
      modelIds: [sonnetModelId],
      tables: [investorTable],
      toolTargets: [{
        name: 'search_knowledge_base',
        description: 'Search Nestfolio documentation to answer user questions',
        handler: searchKbFn,
        schemaPath: path.join(__dirname, 'agent/tools/search-kb.schema.json'),
      }],
      environmentVariables: {
        TABLE_NAME: tableName,
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        AGENT_RUNTIME: 'true',
      },
    });
  }
}
