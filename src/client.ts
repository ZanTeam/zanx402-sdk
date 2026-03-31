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
import { extractSettlementSession } from './utils/fetch-wrappers.js';
import { AuthModule } from './modules/auth.js';
import { CreditsModule } from './modules/credits.js';
import { RpcModule } from './modules/rpc.js';
import { DiscoveryModule } from './modules/discovery.js';
import { InsufficientCreditsError, X402Error } from './errors/index.js';
import { DEFAULT_GATEWAY_URL, DEFAULT_TIMEOUT, DEFAULT_BUNDLE } from './constants.js';

/**
 * X402Client — unified entry point for the x402 Gateway Platform.
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
 * const block = await client.call('eth', 'mainnet', 'eth_blockNumber');
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

  private purchaseInflight: {
    promise: Promise<PurchaseSuccess>;
    resolve: () => void;
    reject: (err: unknown) => void;
  } | null = null;

  constructor(config: X402ClientConfig) {
    const gatewayUrl = config.gatewayUrl ?? DEFAULT_GATEWAY_URL;

    // ── HTTPS check ──────────────────────────────────────────
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(gatewayUrl);
    if (gatewayUrl.startsWith('http://') && !isLocalhost) {
      console.warn(
        '[x402] WARNING: gatewayUrl uses plain HTTP. Private keys, JWTs, and payment ' +
        'signatures will be transmitted in cleartext. Use HTTPS in production.',
      );
    }

    // ── Chain type detection ─────────────────────────────────
    const detectedChainType: ChainType =
      config.chainType ??
      (config.svmPrivateKey || config.svmSigner ? 'SVM' : 'EVM');

    // ── Config validation ────────────────────────────────────
    validateConfig(config, detectedChainType);

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
      config.evmSigner,
      config.svmSigner,
      config.statement,
    );

    this.credits = new CreditsModule(this.http, this.auth, {
      paymentNetwork: config.paymentNetwork,
      solanaRpcUrl: config.solanaRpcUrl,
    });
    this.rpc = new RpcModule(this.http, this.auth);
    this.discovery = new DiscoveryModule(this.http);
  }

  // ─── Token ──────────────────────────────────────────────────

  getToken(): string | undefined {
    return this.http.getToken();
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  async authenticate(): Promise<AuthSuccess> {
    return this.auth.authenticate();
  }

  /** Wipe private keys and session from memory. */
  destroy(): void {
    this.auth.destroy();
  }

  // ─── Auto-purchase mutex ───────────────────────────────────

  /**
   * Concurrency-safe auto-purchase with proper resolve/reject pattern.
   *
   * - First caller initiates the purchase and holds the mutex.
   * - Concurrent callers await the mutex; on success they retry with the
   *   newly-cached JWT rather than purchasing again.
   * - If the first purchase fails, the mutex rejects so waiters can
   *   attempt their own purchase.
   */
  private async autoPurchaseAndRetry<T>(retryFn: () => Promise<T>): Promise<T> {
    if (this.purchaseInflight) {
      try {
        await this.purchaseInflight.promise;
      } catch {
        // First purchase failed — fall through to attempt our own
      }
      // If a token is now cached (first purchase succeeded), just retry
      if (this.getToken() && !this.auth.isExpired()) {
        return retryFn();
      }
    }

    // We are the first caller — set up the mutex
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<PurchaseSuccess>((res, rej) => {
      resolve = () => res(undefined as unknown as PurchaseSuccess);
      reject = rej;
    });
    this.purchaseInflight = { promise, resolve, reject };

    try {
      await this.credits.purchaseCredits(this.config.defaultBundle);
      resolve();
      return retryFn();
    } catch (err) {
      reject(err);
      throw err;
    } finally {
      this.purchaseInflight = null;
    }
  }

  // ─── Fetch (transparent proxy) ──────────────────────────────

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

    // Extract settlement JWT if present
    this.tryExtractSettlementSession(response);

    if (response.status === 402 && this.config.autoPayment) {
      // Guard: ReadableStream bodies cannot be replayed
      if (init?.body instanceof ReadableStream) {
        throw new X402Error(
          'Cannot auto-retry 402 with a ReadableStream body (stream is consumed). ' +
          'Use a string or ArrayBuffer body, or handle 402 manually.',
          'STREAM_BODY_NOT_RETRYABLE',
          402,
        );
      }

      const retryFn = async () => {
        const retryHeaders = new Headers(init?.headers);
        const refreshedToken = this.getToken();
        if (refreshedToken && !retryHeaders.has('Authorization')) {
          retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
        }
        if (!retryHeaders.has('Content-Type') && init?.body) {
          retryHeaders.set('Content-Type', 'application/json');
        }
        const retryResp = await fetchFn(url, { ...init, headers: retryHeaders });
        this.tryExtractSettlementSession(retryResp);
        return retryResp;
      };

      response = await this.autoPurchaseAndRetry(retryFn);
    }

    return response;
  }

  // ─── RPC ────────────────────────────────────────────────────

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
        return this.autoPurchaseAndRetry(() =>
          this.rpc.call<T>(ecosystem, network, method, params),
        );
      }
      throw err;
    }
  }

  async forward<T = unknown>(path: string, options?: ProviderCallOptions): Promise<T> {
    try {
      return await this.rpc.forward<T>(path, options);
    } catch (err) {
      if (err instanceof InsufficientCreditsError && this.config.autoPayment) {
        return this.autoPurchaseAndRetry(() =>
          this.rpc.forward<T>(path, options),
        );
      }
      throw err;
    }
  }

  // ─── Credits ────────────────────────────────────────────────

  async getBalance(): Promise<BalanceResponse> {
    return this.credits.getBalance();
  }

  async purchaseCredits(bundle?: BundleType, paymentSignature?: string): Promise<PurchaseSuccess> {
    return this.credits.purchaseCredits(bundle, paymentSignature);
  }

  async getUsage(params?: UsageQueryParams): Promise<UsageResponse> {
    return this.credits.getUsage(params);
  }

  async getPaymentStatus(idempotencyKey: string): Promise<PaymentStatus> {
    return this.credits.getPaymentStatus(idempotencyKey);
  }

  // ─── Discovery ──────────────────────────────────────────────

  async health(): Promise<HealthResponse> {
    return this.discovery.health();
  }

  async listProviders(): Promise<ProvidersResponse> {
    return this.discovery.listProviders();
  }

  async listNetworks(): Promise<NetworksResponse> {
    return this.discovery.listNetworks();
  }

  async listBundles(): Promise<BundleListResponse> {
    return this.discovery.listBundles();
  }

  async getX402Capability(): Promise<X402Capability> {
    return this.discovery.getX402Capability();
  }

  // ─── Internal ──────────────────────────────────────────────

  private tryExtractSettlementSession(response: Response): void {
    const session = extractSettlementSession(response);
    if (session) {
      const expiresAt = session.expiresAt
        ? new Date(session.expiresAt).getTime()
        : Date.now() + 3600_000;
      this.auth.injectSession(session.token, expiresAt);
    }
  }
}

// ─── Config Validation ────────────────────────────────────────

function validateConfig(config: X402ClientConfig, chainType: ChainType): void {
  const hasEvmCredential = !!(config.wallet || config.privateKey || config.evmSigner);
  const hasSvmCredential = !!(config.svmPrivateKey || config.svmSigner);

  if (chainType === 'EVM' && !hasEvmCredential) {
    if (hasSvmCredential) {
      throw new X402Error(
        'EVM chain type requires wallet, privateKey, or evmSigner, but only SVM credentials were provided.',
        'CONFIG_ERROR',
      );
    }
    // No credentials at all — client can still do public discovery calls
  }

  if (chainType === 'SVM' && !hasSvmCredential) {
    if (hasEvmCredential) {
      throw new X402Error(
        'SVM chain type requires svmPrivateKey or svmSigner, but only EVM credentials were provided.',
        'CONFIG_ERROR',
      );
    }
  }

  if (config.svmPrivateKey && config.svmSigner) {
    console.warn(
      '[x402] Both svmPrivateKey and svmSigner provided; svmSigner takes precedence for auth.',
    );
  }

  if (config.privateKey && config.evmSigner) {
    console.warn(
      '[x402] Both privateKey and evmSigner provided; evmSigner takes precedence for auth.',
    );
  }
}

// ─── Factory Function ──────────────────────────────────────────

export async function createX402Client(config: X402ClientConfig): Promise<X402Client> {
  const client = new X402Client(config);
  if (config.preAuth) {
    await client.authenticate();
  }
  return client;
}
