import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';
import { logger } from '@nestfolio/event-processor';
import type { FeedbackAnnotation } from '../domain';

export interface FeedbackCorrelatorDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly s3: S3Client;
  readonly bedrockAgent: BedrockAgentClient;
  readonly tableName: string;
  readonly kbBucket: string;
  readonly kbId: string;
  readonly kbDataSourceId: string;
}

export const createFeedbackCorrelator = (deps: FeedbackCorrelatorDeps) => ({
  process: async (event: Record<string, unknown>): Promise<void> => {
    // boundary: AppSync mutation event — DECISION_FEEDBACK is sourced from an
    // AppSync mutation, not a CDC producer. No zod contract exists for this payload.
    const subject = (event.subject ?? event) as Record<string, unknown>;
    const decisionId = subject.decisionId as string;
    const outcome = subject.outcome as 'ACCEPTED' | 'REJECTED';
    const rejectionReason = (subject.rejectionReason as string) ?? null;

    // 1. Load original explanation from DDB
    const result = await deps.docClient.send(new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `DECISION#${decisionId}`,
        ':prefix': 'REASONING',
      },
      Limit: 1,
    }));

    const original = result.Items?.[0];
    if (!original) {
      logger.warn('No explanation found for decision, skipping feedback annotation', { decisionId });
      return;
    }

    // 2. Build annotation
    const annotation: FeedbackAnnotation = {
      decisionId,
      tenantId: original.tenantId as string,
      outcome,
      rejectionReason,
      originalSummary: original.summary as string,
      originalTone: original.tone as string,
      originalWordCount: original.wordCount as number,
      originalKeyFactors: original.keyFactors as string[],
      riskCategory: subject.riskCategory as string,
      annotatedAt: new Date().toISOString(),
    };

    // 3. Write to S3
    const key = `feedback/${outcome.toLowerCase()}/${decisionId}-${Date.now()}.json`;
    await deps.s3.send(new PutObjectCommand({
      Bucket: deps.kbBucket,
      Key: key,
      Body: JSON.stringify(annotation, null, 2),
      ContentType: 'application/json',
    }));

    // 4. Trigger KB sync
    await deps.bedrockAgent.send(new StartIngestionJobCommand({
      knowledgeBaseId: deps.kbId,
      dataSourceId: deps.kbDataSourceId,
    }));

    logger.info('Feedback annotation written and KB sync triggered', { decisionId, outcome, key });
  },
});
