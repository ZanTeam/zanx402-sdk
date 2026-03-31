import type { Account, Chain, Transport, WalletClient } from 'viem';
import type { X402ClientConfig, BundleType, ChainType } from './types/common.js';
import type { AuthSuccess } from './types/auth.js';
import type {
  BalanceResponse,
  PurchaseSuccess,
  UsageResponse,
  UsageQueryParams,
  PaymentStatus,
} from './types/credits.js';
import type {
  HealthResponse,
  ProvidersResponse,
  NetworksResponse,
  BundleListResponse,
  X402Capability,
} from './types/discovery.js';
import type { JsonRpcResponse, ProviderCallOptions } from './types/provider.js';
import { HttpClient } from './utils/http.js';
import { AuthModule } from './modules/auth.js';
import { CreditsModule } from './modules/credits.js';
import { RpcModule } from './modules/rpc.js';
import { DiscoveryModule } from './modules/discovery.js';
import { InsufficientCreditsError } from './errors/index.js';
import { DEFAULT_GATEWAY_URL, DEFAULT_TIMEOUT, DEFAULT_BUNDLE } from './constants.js';

/**
 * X402Client — unified entry point for the x402 Gateway Platform.
 *
 * - Tree-shakeable sub-modules (auth, credits, rpc, discovery)
 * - Auto-payment flow on 402 responses
 * - Automatic JWT lifecycle management
 * - Fetch API compatible `fetch()` wrapper for transparent proxying
 * - `preAuth` support via `createX402Client()` factory
 *
 * @example
 * ```ts
 * import { createX402Client } from '@zan_team/x402';
 *
 * const client = await createX402Client({
 *   gatewayUrl: 'https://x402.zan.top',
 *   privateKey: '0x...',
 *   autoPayment: true,
 *   preAuth: true,
 * });
 *
 * // High-level RPC helper
 * const block = await client.call('eth', 'mainnet', 'eth_blockNumber');
 *
 * // Or use the Fetch API wrapper (transparent auth + auto-pay)
 * const res = await client.fetch('/rpc/eth/mainnet', {
 *   method: 'POST',
 *   body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
 * });
 * ```
 */
export class X402Client {
  readonly auth: AuthModule;
  readonly credits: CreditsModule;
  readonly rpc: RpcModule;
  readonly discovery: DiscoveryModule;

  private readonly config: Required<
    Pick<X402ClientConfig, 'gatewayUrl' | 'chainType' | 'autoPayment' | 'defaultBundle' | 'timeout'>
  >;
  private readonly http: HttpClient;
  private purchasePromise?: Promise<PurchaseSuccess>;

  constructor(config: X402ClientConfig) {
    const gatewayUrl = config.gatewayUrl ?? DEFAULT_GATEWAY_URL;
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(gatewayUrl);
    if (gatewayUrl.startsWith('http://') && !isLocalhost) {
      console.warn(
        '[x402] WARNING: gatewayUrl uses plain HTTP. Private keys, JWTs, and payment ' +
        'signatures will be transmitted in cleartext. Use HTTPS in production.',
      );
    }

    const detectedChainType: ChainType =
      config.chainType ?? (config.svmPrivateKey ? 'SVM' : 'EVM');

    this.config = {
      gatewayUrl,
      chainType: detectedChainType,
      autoPayment: config.autoPayment ?? false,
      defaultBundle: config.defaultBundle ?? DEFAULT_BUNDLE,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    };

    this.http = new HttpClient(this.config.gatewayUrl, this.config.timeout, config.fetch);

    this.auth = new AuthModule(
      this.http,
      this.config.gatewayUrl,
      this.config.chainType,
      config.wallet,
      config.privateKey,
      config.svmPrivateKey,
    );

    this.credits = new CreditsModule(this.http, this.auth, {
      paymentNetwork: config.paymentNetwork,
      solanaRpcUrl: config.solanaRpcUrl,
    });
    this.rpc = new RpcModule(this.http, this.auth);
    this.discovery = new DiscoveryModule(this.http);
  }

  // ─── Token ──────────────────────────────────────────────────

  /**
   * Get the current JWT token (if authenticated).
   * Useful for custom requests outside the SDK.
   */
  getToken(): string | undefined {
    return this.http.getToken();
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  /** Authenticate with the gateway (SIWE/SIWS) */
  async authenticate(): Promise<AuthSuccess> {
    return this.auth.authenticate();
  }

  /** Wipe private keys and session from memory. */
  destroy(): void {
    this.auth.destroy();
  }

  /**
   * Concurrency-safe auto-purchase: only one purchase runs at a time.
   * Subsequent callers await the same promise.
   */
  private autoPurchase(): Promise<PurchaseSuccess> {
    if (!this.purchasePromise) {
      this.purchasePromise = this.credits
        .purchaseCredits(this.config.defaultBundle)
        .finally(() => { this.purchasePromise = undefined; });
    }
    return this.purchasePromise;
  }

  // ─── Fetch (transparent proxy) ──────────────────────────────

  /**
   * Fetch API compatible wrapper with automatic JWT injection and
   * 402 auto-payment. Works like `globalThis.fetch` but handles
   * authentication and payment negotiation transparently.
   *
   * @param pathOrUrl - Relative path (e.g. "/rpc/eth/mainnet") or full URL
   * @param init      - Standard RequestInit options
   * @returns Standard Response object
   *
   * @example
   * ```ts
   * const res = await client.fetch('/rpc/eth/mainnet', {
   *   method: 'POST',
   *   headers: { 'Content-Type': 'application/json' },
   *   body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
   * });
   * const data = await res.json();
   * ```
   */
  async fetch(pathOrUrl: string, init?: RequestInit): Promise<Response> {
    await this.auth.ensureAuthenticated();

    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.config.gatewayUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

    const headers = new Headers(init?.headers);
    const token = this.getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Content-Type') && init?.body) {
      headers.set('Content-Type', 'application/json');
    }

    const fetchFn = this.http.getFetchFn();

    let response = await fetchFn(url, { ...init, headers });

    if (response.status === 402 && this.config.autoPayment) {
      await this.autoPurchase();

      const retryHeaders = new Headers(init?.headers);
      const refreshedToken = this.getToken();
      if (refreshedToken && !retryHeaders.has('Authorization')) {
        retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
      }
      if (!retryHeaders.has('Content-Type') && init?.body) {
        retryHeaders.set('Content-Type', 'application/json');
      }
      response = await fetchFn(url, { ...init, headers: retryHeaders });
    }

    return response;
  }

  // ─── RPC ────────────────────────────────────────────────────

  /**
   * Send a JSON-RPC call with automatic 402 handling.
   *
   * If `autoPayment` is enabled and a 402 (insufficient credits) is received,
   * the SDK will automatically purchase the default bundle and retry once.
   */
  async call<T = unknown>(
    ecosystem: string,
    network: string,
    method: string,
    params: unknown[] = [],
  ): Promise<JsonRpcResponse<T>> {
    try {
      return await this.rpc.call<T>(ecosystem, network, method, params);
    } catch (err) {
      if (err instanceof InsufficientCreditsError && this.config.autoPayment) {
        await this.autoPurchase();
        return this.rpc.call<T>(ecosystem, network, method, params);
      }
      throw err;
    }
  }

  /**
   * Forward a generic request to a provider route.
   * Supports auto-payment on 402.
   */
  async forward<T = unknown>(path: string, options?: ProviderCallOptions): Promise<T> {
    try {
      return await this.rpc.forward<T>(path, options);
    } catch (err) {
      if (err instanceof InsufficientCreditsError && this.config.autoPayment) {
        await this.autoPurchase();
        return this.rpc.forward<T>(path, options);
      }
      throw err;
    }
  }

  // ─── Credits ────────────────────────────────────────────────

  /** Get credit balance */
  async getBalance(): Promise<BalanceResponse> {
    return this.credits.getBalance();
  }

  /** Purchase credits */
  async purchaseCredits(bundle?: BundleType, paymentSignature?: string): Promise<PurchaseSuccess> {
    return this.credits.purchaseCredits(bundle, paymentSignature);
  }

  /** Get usage records */
  async getUsage(params?: UsageQueryParams): Promise<UsageResponse> {
    return this.credits.getUsage(params);
  }

  /** Query payment status */
  async getPaymentStatus(idempotencyKey: string): Promise<PaymentStatus> {
    return this.credits.getPaymentStatus(idempotencyKey);
  }

  // ─── Discovery ──────────────────────────────────────────────

  /** Health check */
  async health(): Promise<HealthResponse> {
    return this.discovery.health();
  }

  /** List providers */
  async listProviders(): Promise<ProvidersResponse> {
    return this.discovery.listProviders();
  }

  /** List networks */
  async listNetworks(): Promise<NetworksResponse> {
    return this.discovery.listNetworks();
  }

  /** List bundles */
  async listBundles(): Promise<BundleListResponse> {
    return this.discovery.listBundles();
  }

  /** x402 capability */
  async getX402Capability(): Promise<X402Capability> {
    return this.discovery.getX402Capability();
  }

}

// ─── Factory Function ──────────────────────────────────────────

/**
 * Create an X402Client with optional pre-authentication.
 *
 * When `preAuth: true` is set, the factory authenticates (SIWE/SIWS + JWT)
 * before returning, so the first request is faster.
 *
 * @example
 * ```ts
 * const client = await createX402Client({
 *   gatewayUrl: 'https://x402.zan.top',
 *   privateKey: '0x...',
 *   autoPayment: true,
 *   preAuth: true,
 * });
 *
 * // Already authenticated — first call is fast
 * const block = await client.call('eth', 'mainnet', 'eth_blockNumber');
 * ```
 */
export async function createX402Client(config: X402ClientConfig): Promise<X402Client> {
  const client = new X402Client(config);
  if (config.preAuth) {
    await client.authenticate();
  }
  return client;
}
