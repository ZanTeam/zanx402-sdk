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
} as const;

/** JWT refresh buffer — re-authenticate 60s before expiry */
export const JWT_REFRESH_BUFFER_MS = 60_000;

/** SIWE/SIWS message expiry — 5 minutes from issuance */
export const SIWE_EXPIRY_MS = 5 * 60 * 1000;
