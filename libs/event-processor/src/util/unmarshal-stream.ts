import type { DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { StreamRecord, StreamContext } from '../types/stream-types';

export function unmarshalStream(
  record: DynamoDBRecord,
  serviceName: string,
): { streamRecord: StreamRecord; ctx: StreamContext } | null {
  const eventName = record.eventName as 'INSERT' | 'MODIFY' | 'REMOVE';
  const image = eventName === 'REMOVE'
    ? record.dynamodb?.OldImage
    : record.dynamodb?.NewImage;

  if (!image) return null;

  const unmarshalled = unmarshall(image as Record<string, AttributeValue>);

  const oldImageRaw = record.dynamodb?.OldImage;
  const oldImage = (oldImageRaw && oldImageRaw !== image)
    ? unmarshall(oldImageRaw as Record<string, AttributeValue>)
    : (eventName === 'REMOVE' ? unmarshalled : undefined);

  return {
    streamRecord: {
      pk: unmarshalled.pk as string,
      sk: unmarshalled.sk as string,
      __typename: unmarshalled.__typename as string,
      tenantId: unmarshalled.tenantId as string,
      eventName,
      ...unmarshalled,
    } as StreamRecord,
    ctx: {
      serviceName,
      record,
      eventName,
      keys: { pk: unmarshalled.pk as string, sk: unmarshalled.sk as string },
      typename: unmarshalled.__typename as string,
      tenantId: unmarshalled.tenantId as string,
      newImage: eventName !== 'REMOVE' ? unmarshalled : undefined,
      oldImage,
    },
  };
}
