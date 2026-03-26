import type { Account, Chain, Transport, WalletClient } from 'viem';

export type ChainType = 'EVM' | 'SVM';

export type Tier = 'trial' | 'micro' | 'standard' | 'pro';

export type BundleType = 'default' | 'standard' | 'bulk';

export interface X402ClientConfig {
  /** Gateway base URL, e.g. "https://x402.zan.top" */
  gatewayUrl: string;

  // ── EVM Auth ───────────────────────────────────────────────
  /** viem WalletClient for EVM signing */
  wallet?: WalletClient<Transport, Chain, Account>;
  /** Raw EVM private key (hex) — used when WalletClient is not provided */
  privateKey?: `0x${string}`;

  // ── SVM Auth ───────────────────────────────────────────────
  /** Solana private key (Base58-encoded secret key) for SIWS authentication */
  svmPrivateKey?: string;

  /** Blockchain auth type. Auto-detected from provided keys when omitted. */
  chainType?: ChainType;

  // ── Payment ────────────────────────────────────────────────
  /**
   * CAIP-2 payment network identifier (e.g. "eip155:8453" for Base).
   * The payment network is decoupled from the chain you query — you can
   * pay on Base and query Ethereum or Solana.
   */
  paymentNetwork?: string;
  /** Auto-purchase credits when receiving 402 */
  autoPayment?: boolean;
  /** Default bundle for auto-purchase */
  defaultBundle?: BundleType;

  // ── Lifecycle ──────────────────────────────────────────────
  /**
   * Pre-authenticate on client creation (SIWE / SIWS + JWT).
   * When `true`, `createX402Client()` will call `authenticate()` before
   * returning the client, so the first request is faster.
   */
  preAuth?: boolean;

  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom fetch implementation (for testing / Node.js polyfills) */
  fetch?: typeof globalThis.fetch;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export interface ErrorBody {
  error: string;
  message: string;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}
