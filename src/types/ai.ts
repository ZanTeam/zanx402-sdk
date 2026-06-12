import type { PaymentRequiredPayload } from './credits.js';

// ── Request ─────────────────────────────────────────────

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  messages: AiMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
}

export interface AiCallOptions {
  timeout?: number;
  paymentSignature?: string;
}

// ── Response ────────────────────────────────────────────

export interface AiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AiChatData {
  model: string;
  content: string;
  usage: AiUsage;
  finish_reason: string;
}

export interface AiChatResponse {
  success: true;
  data: AiChatData;
  traceId?: string;
}

// ── Model List ──────────────────────────────────────────

export interface AiModelInfo {
  model_name: string;
  endpoint: string;
  price: number;
}

export interface AiModelListResponse {
  success: true;
  data: AiModelInfo[];
}

// ── Model Discovery ─────────────────────────────────────

export interface AiDiscoveryResponse {
  [key: string]: unknown;
}

// ── Call History ─────────────────────────────────────────

export interface AiCallHistoryParams {
  modelId?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  page?: number;
  size?: number;
}

export interface AiCallRecord {
  id: number;
  model: string;
  status: string;
  tokens: number;
  cost: number;
  createdAt: string;
}

export interface AiCallHistoryResponse {
  records: AiCallRecord[];
  total: number;
  page: number;
  size: number;
}

export interface AiCallDetail extends AiCallRecord {
  request: unknown;
  response: unknown;
  latencyMs: number;
  paymentNetwork: string;
  txHash?: string;
}

// ── Call Stats ───────────────────────────────────────────

export interface AiCallStatsParams {
  groupBy?: 'model' | 'day' | 'week';
  startTime?: string;
  endTime?: string;
}

export interface AiCallStatsResponse {
  stats: AiCallStatEntry[];
}

export interface AiCallStatEntry {
  key: string;
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number;
}

// ── Payment Required (re-export for convenience) ────────

export type { PaymentRequiredPayload } from './credits.js';
