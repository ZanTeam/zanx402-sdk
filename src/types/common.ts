import type { Account, Chain, Transport, WalletClient } from 'viem';

export type ChainType = 'EVM' | 'SVM';

export type Tier = 'trial' | 'micro' | 'standard' | 'pro';

export type BundleType = 'default' | 'standard' | 'bulk';

// ── Signer Abstractions ──────────────────────────────────────

/**
 * Lightweight EVM signer for SIWE authentication.
 * Compatible with viem Account interface — avoids requiring a full WalletClient.
 * Security-conscious users can provide this instead of a raw private key.
 */
export interface EvmMessageSigner {
  address: `0x${string}`;
  signMessage(params: { message: string }): Promise<`0x${string}`>;
  getChainId?(): Promise<number>;
}

/**
 * SVM signer for SIWS authentication and optional payment transaction signing.
 * Security-conscious users can provide this instead of a raw Base58 private key.
 */
export interface SvmSigner {
  publicKey: string;
  signMessage(message: string): Promise<{ signature: string }>;
  /** Sign a serialized VersionedTransaction. Required for auto-payment on Solana. */
  signTransaction?(serializedTx: Uint8Array): Promise<Uint8Array>;
}

// ── Client Config ────────────────────────────────────────────

export interface X402ClientConfig {
  /** Gateway base URL, e.g. "https://x402.zan.top" */
  gatewayUrl: string;

  // ── EVM Auth ───────────────────────────────────────────────
  /** viem WalletClient for EVM signing */
  wallet?: WalletClient<Transport, Chain, Account>;
  /** Raw EVM private key (hex) — used when WalletClient is not provided */
  privateKey?: `0x${string}`;
  /** Custom EVM signer — overrides wallet / privateKey for auth signing */
  evmSigner?: EvmMessageSigner;

  // ── SVM Auth ───────────────────────────────────────────────
  /** Solana private key (Base58-encoded secret key) for SIWS authentication */
  svmPrivateKey?: string;
  /** Custom SVM signer — overrides svmPrivateKey for auth + payment signing */
  svmSigner?: SvmSigner;

  /** Blockchain auth type. Auto-detected from provided keys when omitted. */
  chainType?: ChainType;

  // ── Payment ────────────────────────────────────────────────
  /**
   * CAIP-2 payment network identifier (e.g. "eip155:8453" for Base,
   * or "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" for Solana Devnet).
   * Used to pick the matching entry in PAYMENT-REQUIRED when auto-purchasing.
   */
  paymentNetwork?: string;
  /** Solana RPC URL for building USDC payment txs (default maps from payment network). */
  solanaRpcUrl?: string;
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

  /** SIWX statement text included in auth messages. */
  statement?: string;

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
