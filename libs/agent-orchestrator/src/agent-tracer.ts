import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import type { ModelTier } from './types';

export interface AgentTraceEnvelope {
  'gen_ai.invocation.started_at': string;
  'gen_ai.invocation.completed_at': string;
  'gen_ai.invocation.latency_ms': number;
  status: 'success' | 'error';
  llmCalls: Array<{
    nodeName: string;
    // `'unknown'` signals an unrecognised Bedrock model id — fail loudly rather
    // than silently mis-classifying a new tier as sonnet.
    'gen_ai.request.model': ModelTier | 'unknown';
    'gen_ai.usage.input_tokens': number;
    'gen_ai.usage.output_tokens': number;
    'gen_ai.operation.name': 'chat';
    latencyMs: number;
    // Set only when the current tier strictly outranks the previous one
    // (haiku < sonnet < opus). Fallbacks / de-escalations / unknown-tier
    // transitions leave this undefined.
    escalatedFromTier?: ModelTier;
  }>;
  toolCalls: Array<{
    nodeName: string;
    toolName: string;
    status: 'success' | 'error';
    latencyMs: number;
    argKeys: string[];
    resultKeys?: string[];
  }>;
  nodeSequence: Array<{ nodeName: string; startedAt: string; completedAt: string }>;
  errors: Array<{ nodeName?: string; kind: string; message: string }>;
}

export interface AgentTraceEventDetail {
  context: { tenantId: string };
  correlationId: string;
  agent: string;
  envelope: AgentTraceEnvelope;
  emittedAt: string;
}

// Tier rank for rank-based escalation detection. Used only when both the
// previous and current tier are known ModelTiers.
const TIER_RANK: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };

export class AgentTracer extends BaseCallbackHandler {
  name = 'agent-tracer';

  private readonly startedAtMs = Date.now();
  private readonly llmCalls: AgentTraceEnvelope['llmCalls'] = [];
  private readonly toolCalls: AgentTraceEnvelope['toolCalls'] = [];
  private readonly nodeSequence: AgentTraceEnvelope['nodeSequence'] = [];
  private readonly errors: AgentTraceEnvelope['errors'] = [];
  private readonly pendingLlm = new Map<string, { model: ModelTier | 'unknown'; startedAtMs: number; node?: string }>();
  private readonly pendingTool = new Map<string, { toolName: string; startedAtMs: number; argKeys: string[]; node?: string }>();
  // Keyed by LangChain runId. Acts as BOTH the node-sequence buffer (so
  // parallel chain start/end cannot mis-attribute completedAt timestamps)
  // AND the authoritative lookup for "which node owns run X" — used by
  // LLM / tool callbacks via their `parentRunId` argument.
  private readonly pendingChains = new Map<string, { nodeName: string; startedAt: string }>();
  private lastTier?: ModelTier | 'unknown';

  // Node ownership for LLM/tool runs is resolved via `parentRunId` — the runId
  // of the chain that invoked them. No shared `currentNode` field: when two
  // nodes fan out in parallel (portfolio-engine, investor-profile wave), a
  // mutable "current node" pointer would attribute LLM/tool calls to whichever
  // chain started most recently instead of the actual parent.
  private nodeFor(parentRunId: string | undefined): string | undefined {
    return parentRunId ? this.pendingChains.get(parentRunId)?.nodeName : undefined;
  }

  handleChainStart(chain: Serialized, _inputs: unknown, runId: string): void {
    const nodeName = extractNodeName(chain);
    if (!nodeName) return;
    this.pendingChains.set(runId, { nodeName, startedAt: new Date().toISOString() });
  }

  handleChainEnd(_outputs: unknown, runId: string): void {
    const pending = this.pendingChains.get(runId);
    if (!pending) return;
    this.pendingChains.delete(runId);
    this.nodeSequence.push({
      nodeName: pending.nodeName,
      startedAt: pending.startedAt,
      completedAt: new Date().toISOString(),
    });
  }

  handleChainError(err: Error, runId: string): void {
    const pending = this.pendingChains.get(runId);
    this.errors.push({ nodeName: pending?.nodeName, kind: 'chain_error', message: err.message });
  }

  // LangChain signature: (llm, prompts, runId, parentRunId?, extraParams?, tags?, metadata?, runName?)
  handleLLMStart(llm: Serialized, _prompts: string[], runId: string, parentRunId?: string): void {
    const model = extractModelTier(llm);
    this.pendingLlm.set(runId, { model, startedAtMs: Date.now(), node: this.nodeFor(parentRunId) });
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const pending = this.pendingLlm.get(runId);
    if (!pending) return;
    this.pendingLlm.delete(runId);
    const rawUsage =
      (output.llmOutput as { tokenUsage?: Record<string, number>; usage?: Record<string, number> } | undefined);
    const usage = rawUsage?.tokenUsage ?? rawUsage?.usage ?? {};
    // Rank-based escalation: only set when both tiers are known AND the new
    // tier strictly outranks the previous one. Fallbacks (opus→sonnet) and
    // unknown-tier transitions leave escalatedFromTier undefined — the field
    // means "escalated from", not "differs from".
    const prev = this.lastTier;
    const cur = pending.model;
    const escalatedFromTier =
      prev && prev !== 'unknown' && cur !== 'unknown' && TIER_RANK[cur] > TIER_RANK[prev]
        ? prev
        : undefined;
    this.llmCalls.push({
      nodeName: pending.node ?? 'unknown',
      'gen_ai.request.model': pending.model,
      'gen_ai.usage.input_tokens': Number(usage.input_tokens ?? usage.promptTokens ?? 0),
      'gen_ai.usage.output_tokens': Number(usage.output_tokens ?? usage.completionTokens ?? 0),
      'gen_ai.operation.name': 'chat',
      latencyMs: Date.now() - pending.startedAtMs,
      escalatedFromTier,
    });
    this.lastTier = pending.model;
  }

  handleLLMError(err: Error, runId: string): void {
    const pending = this.pendingLlm.get(runId);
    this.errors.push({ nodeName: pending?.node, kind: 'llm_error', message: err.message });
  }

  // LangChain signature: (tool, input, runId, parentRunId?, tags?, metadata?, runName?)
  handleToolStart(tool: Serialized, input: string, runId: string, parentRunId?: string): void {
    const toolName = extractToolName(tool);
    let argKeys: string[] = [];
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') argKeys = Object.keys(parsed);
    } catch {
      /* non-JSON input — argKeys stays empty */
    }
    this.pendingTool.set(runId, {
      toolName,
      startedAtMs: Date.now(),
      argKeys,
      node: this.nodeFor(parentRunId),
    });
  }

  handleToolEnd(output: string, runId: string): void {
    const pending = this.pendingTool.get(runId);
    if (!pending) return;
    this.pendingTool.delete(runId);
    let resultKeys: string[] | undefined;
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') resultKeys = Object.keys(parsed);
    } catch {
      /* non-JSON output — resultKeys stays undefined */
    }
    this.toolCalls.push({
      nodeName: pending.node ?? 'unknown',
      toolName: pending.toolName,
      status: 'success',
      latencyMs: Date.now() - pending.startedAtMs,
      argKeys: pending.argKeys,
      resultKeys,
    });
  }

  handleToolError(err: Error, runId: string): void {
    const pending = this.pendingTool.get(runId);
    if (!pending) return;
    this.pendingTool.delete(runId);
    this.toolCalls.push({
      nodeName: pending.node ?? 'unknown',
      toolName: pending.toolName,
      status: 'error',
      latencyMs: Date.now() - pending.startedAtMs,
      argKeys: pending.argKeys,
    });
    this.errors.push({ nodeName: pending.node, kind: 'tool_error', message: err.message });
  }

  build(status: 'success' | 'error'): AgentTraceEnvelope {
    const completedAtMs = Date.now();
    return {
      'gen_ai.invocation.started_at': new Date(this.startedAtMs).toISOString(),
      'gen_ai.invocation.completed_at': new Date(completedAtMs).toISOString(),
      'gen_ai.invocation.latency_ms': completedAtMs - this.startedAtMs,
      status,
      llmCalls: this.llmCalls,
      toolCalls: this.toolCalls,
      nodeSequence: this.nodeSequence,
      errors: this.errors,
    };
  }
}

export function extractNodeName(chain: Serialized | undefined): string | undefined {
  if (!chain) return undefined;
  const kwargs = (chain as { kwargs?: { name?: string } }).kwargs;
  if (kwargs?.name) return kwargs.name;
  const idSegments = (chain as { id?: string[] }).id;
  if (Array.isArray(idSegments) && idSegments.length > 0) return idSegments[idSegments.length - 1];
  return undefined;
}

export function extractModelTier(llm: Serialized | undefined): ModelTier | 'unknown' {
  const kwargs = (llm as { kwargs?: { model?: string; modelName?: string; model_id?: string } } | undefined)?.kwargs;
  const modelId = kwargs?.model ?? kwargs?.modelName ?? kwargs?.model_id ?? '';
  if (/haiku/i.test(modelId)) return 'haiku';
  if (/opus/i.test(modelId)) return 'opus';
  if (/sonnet/i.test(modelId)) return 'sonnet';
  // Deliberately NOT defaulting to sonnet: an unknown model id should fail
  // assertions loudly rather than masquerade as the expected tier.
  return 'unknown';
}

export function extractToolName(tool: Serialized | undefined): string {
  if (!tool) return 'unknown';
  const kwargs = (tool as { kwargs?: { name?: string } }).kwargs;
  if (kwargs?.name) return kwargs.name;
  const id = (tool as { id?: string[] }).id;
  if (Array.isArray(id) && id.length > 0) return id[id.length - 1];
  return 'unknown';
}
