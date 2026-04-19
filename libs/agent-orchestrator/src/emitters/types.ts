import type { AgentTraceEnvelope } from '../agent-tracer';

export interface EmitContext {
  tenantId: string;
  correlationId: string;
  agent: string;
}

export interface TraceEmitter {
  emit(envelope: AgentTraceEnvelope, ctx: EmitContext): Promise<void>;
}
