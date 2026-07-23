export const DEFAULT_TIMEOUT = 30_000;
export const DEFAULT_GATEWAY_URL = 'https://x402.zan.top';
export const DEFAULT_BUNDLE = 'default' as const;

export const ENDPOINTS = {
  AUTH: '/auth',
  BALANCE: '/credits/balance',
  PURCHASE: '/credits/purchase',
  USAGE: '/credits/usage',
  PAYMENT_STATUS: '/credits/payment',
  HEALTH: '/health',
  PROVIDERS: '/providers',
  NETWORKS: '/networks',
  BUNDLES: '/credits/bundles',
  WELL_KNOWN: '/.well-known/x402.json',
  LLMS_TXT: '/llms.txt',
  RPC: '/rpc',
} as const;

export const HEADERS = {
  AUTHORIZATION: 'Authorization',
  CONTENT_TYPE: 'Content-Type',
  PAYMENT_SIGNATURE: 'PAYMENT-SIGNATURE',
  PAYMENT_REQUIRED: 'PAYMENT-REQUIRED',
  PAYMENT_RESPONSE: 'PAYMENT-RESPONSE',
  TRACE_ID: 'x-trace-id',
  IDEMPOTENCY_KEY: 'Idempotency-Key',
} as const;

export const DEFAULT_STATEMENT = 'Sign in to x402 Gateway Platform';

/** JWT refresh buffer — re-authenticate 60s before expiry */
export const JWT_REFRESH_BUFFER_MS = 60_000;

/** SIWE/SIWS message expiry — 5 minutes from issuance */
export const SIWE_EXPIRY_MS = 5 * 60 * 1000;

export const AI_ENDPOINTS = {
  CHAT: '/ai',
  MODELS: '/api/models',
  DISCOVERY: '/v1/discovery/ai',
  PAYMENT_NETWORKS: '/v1/discovery/ai/payment-networks',
  CALLS: '/v1/ai/calls',
  CALLS_STATS: '/v1/ai/calls/stats',
} as const;

export const DEFAULT_AI_TIMEOUT = 120_000;
