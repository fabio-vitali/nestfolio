import type { TraceEmitter } from './types';

export class NoopTraceEmitter implements TraceEmitter {
  async emit(): Promise<void> {
    /* no-op */
  }
}
