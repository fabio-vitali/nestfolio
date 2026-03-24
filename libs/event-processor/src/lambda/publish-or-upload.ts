import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type Bus, type BusEvent } from '../platform/bus';
import { getUUID, getTime } from '../platform/core';

const MAX_EVENT_SIZE = 256 * 1024; // 256 KB
const PRESIGNED_URL_TTL = 3600; // 1 hour

export interface PublishOrUploadParams {
  readonly bus: Bus;
  readonly bucket: string;
  readonly eventType: string;
  readonly content: Record<string, unknown>;
  readonly serviceName: string;
}

const s3 = new S3Client({});

export async function publishOrUpload(params: PublishOrUploadParams): Promise<void> {
  const { bus, bucket, eventType, content, serviceName } = params;
  const serialized = JSON.stringify(content);
  const sizeBytes = Buffer.byteLength(serialized, 'utf-8');

  const eventId = getUUID();
  const timestamp = getTime();

  if (sizeBytes <= MAX_EVENT_SIZE) {
    const event: BusEvent<Record<string, unknown>, Record<string, unknown>> = {
      id: eventId,
      type: eventType,
      timestamp,
      subject: { delivery: 'inline', content },
      context: { serviceName },
    };
    await bus.publish(event);
  } else {
    const key = `${serviceName}/${eventType}/${eventId}.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: serialized,
        ContentType: 'application/json',
      }),
    );

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: PRESIGNED_URL_TTL },
    );

    const event: BusEvent<Record<string, unknown>, Record<string, unknown>> = {
      id: eventId,
      type: eventType,
      timestamp,
      subject: { delivery: 's3-presigned', url, bucket, key },
      context: { serviceName },
    };
    await bus.publish(event);
  }
}
