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
  txHash?: string | null;
  paymentNetwork?: string | null;
  traceId?: string;
}

// ── Model List ──────────────────────────────────────────

export interface AiModelInfo {
  model_name: string;
  display_name?: string;
  endpoint: string;
  input_price_per_token: number;
  output_price_per_token: number;
  /** @deprecated use input_price_per_token / output_price_per_token */
  price?: number;
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
  requestId: string;
  wallet: string;
  modelId: string;
  protocolFamily: string;
  requestPath: string;
  httpMethod: string;
  httpStatus: number;
  errorCode: string;
  priceUsdc: number;
  currency: string;
  network: string;
  isRefunded: number;
  gatewayLatencyMs: number;
  upstreamLatencyMs: number;
  upstreamErrorClass: string;
  inputTokens: number;
  outputTokens: number;
  settlementStatus: string;
  gmtCreate: string;
}

export interface AiCallHistoryResponse {
  result: string;
  msg: string;
  data: {
    content: AiCallRecord[];
    totalElements: number;
    totalPages: number;
  };
}

export interface AiCallDetail extends AiCallRecord {
  request: unknown;
  response: unknown;
  inputPricePerToken: string;
  outputPricePerToken: string;
  txHash?: string;
}

// ── Call Stats ───────────────────────────────────────────

export interface AiCallStatsParams {
  groupBy?: 'model' | 'date';
  startTime?: string;
  endTime?: string;
}

export interface AiCallStatsResponse {
  result: string;
  msg: string;
  data: AiCallStatEntry[];
}

export interface AiCallStatEntry {
  key: string;
  totalCalls: number;
  successCalls: number;
  totalUsdc: number;
  refundedUsdc: number;
  avgGatewayLatencyMs: number;
}

// ── Payment Required (re-export for convenience) ────────

export type { PaymentRequiredPayload } from './credits.js';
