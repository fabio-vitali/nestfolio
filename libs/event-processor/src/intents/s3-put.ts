import type { S3PutIntent } from '../types/write-intent';

export function s3Put(body: unknown, opts?: { format?: 'json' | 'csv'; key?: string }): S3PutIntent {
  return {
    _tag: 's3-put',
    body,
    format: opts?.format ?? 'json',
    key: opts?.key,
  };
}
