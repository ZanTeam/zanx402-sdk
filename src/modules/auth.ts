import type { Account, Chain, Transport, WalletClient } from 'viem';
import type { AuthSuccess, AuthSession } from '../types/auth.js';
import type { ChainType } from '../types/common.js';
import { HttpClient, assertShape } from '../utils/http.js';
import { buildSiweMessage, extractDomain, generateNonce } from '../utils/siwe.js';
import { buildSiwsMessage, signSolanaMessage } from '../utils/siws.js';
import { ENDPOINTS, JWT_REFRESH_BUFFER_MS, SIWE_EXPIRY_MS } from '../constants.js';
import { AuthenticationError, SessionExpiredError } from '../errors/index.js';

export class AuthModule {
  private readonly http: HttpClient;
  private readonly gatewayUrl: string;
  private session?: AuthSession;
  private wallet?: WalletClient<Transport, Chain, Account>;
  private privateKey?: `0x${string}`;
  private _svmPrivateKey?: Uint8Array;
  private chainType: ChainType;
  private authPromise?: Promise<AuthSuccess>;

  constructor(
    http: HttpClient,
    gatewayUrl: string,
    chainType: ChainType = 'EVM',
    wallet?: WalletClient<Transport, Chain, Account>,
    privateKey?: `0x${string}`,
    svmPrivateKey?: string,
  ) {
    this.http = http;
    this.gatewayUrl = gatewayUrl;
    this.chainType = chainType;
    this.wallet = wallet;
    this.privateKey = privateKey;
    if (svmPrivateKey) {
      this._svmPrivateKey = new TextEncoder().encode(svmPrivateKey);
    }
  }

  /** Authenticate using SIWE (EVM) or SIWS (Solana) and store session JWT */
  async authenticate(): Promise<AuthSuccess> {
    if (this.chainType === 'SVM') {
      return this.authenticateSvm();
    }
    return this.authenticateEvm();
  }

  /** Ensure we have a valid session, re-authenticating if needed (concurrency-safe). */
  async ensureAuthenticated(): Promise<void> {
    if (!this.session || this.isExpiringSoon()) {
      if (!this.authPromise) {
        this.authPromise = this.authenticate().finally(() => {
          this.authPromise = undefined;
        });
      }
      await this.authPromise;
    }
  }

  /** Get current session (or null) */
  getSession(): AuthSession | undefined {
    return this.session;
  }

  /** Check if the session token is about to expire */
  isExpiringSoon(): boolean {
    if (!this.session) return true;
    return Date.now() >= this.session.expiresAt - JWT_REFRESH_BUFFER_MS;
  }

  /** Check if session is expired */
  isExpired(): boolean {
    if (!this.session) return true;
    return Date.now() >= this.session.expiresAt;
  }

  /** Clear the stored session */
  clearSession(): void {
    this.session = undefined;
    this.http.setToken(undefined);
  }

  getChainType(): ChainType {
    return this.chainType;
  }

  /** @internal CreditsModule only — returns Base58 key and should not be cached. */
  _borrowSvmPrivateKey(): string | undefined {
    if (!this._svmPrivateKey) return undefined;
    return new TextDecoder().decode(this._svmPrivateKey);
  }

  /** Wipe all private key material from memory. Call when client is no longer needed. */
  destroy(): void {
    this.privateKey = undefined;
    if (this._svmPrivateKey) {
      this._svmPrivateKey.fill(0);
      this._svmPrivateKey = undefined;
    }
    this.clearSession();
  }

  // ── EVM (SIWE) ──────────────────────────────────────────────

  private async authenticateEvm(): Promise<AuthSuccess> {
    const walletClient = await this.resolveWalletClient();
    const address = walletClient.account.address;
    const domain = extractDomain(this.gatewayUrl);
    const nonce = generateNonce();

    const message = buildSiweMessage({
      domain,
      address,
      uri: this.gatewayUrl,
      nonce,
      chainId: await walletClient.getChainId(),
      statement: 'Sign in to x402 Gateway Platform',
      expirationTime: new Date(Date.now() + SIWE_EXPIRY_MS).toISOString(),
    });

    let signature: string;
    try {
      signature = await walletClient.signMessage({ message });
    } catch (err) {
      throw new AuthenticationError(
        `Failed to sign SIWE message: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    return this.postAuth('EVM', message, signature);
  }

  // ── SVM (SIWS) ──────────────────────────────────────────────

  private async authenticateSvm(): Promise<AuthSuccess> {
    const svmKey = this._borrowSvmPrivateKey();
    if (!svmKey) {
      throw new AuthenticationError(
        'No svmPrivateKey provided. Pass a Base58-encoded Solana secret key for SIWS authentication.',
      );
    }

    const { publicKey } = await signSolanaMessage('ping', svmKey);

    const domain = extractDomain(this.gatewayUrl);
    const nonce = generateNonce();

    const message = buildSiwsMessage({
      domain,
      address: publicKey,
      uri: this.gatewayUrl,
      nonce,
      chainId: 'mainnet',
      statement: 'Sign in to x402 Gateway Platform',
      expirationTime: new Date(Date.now() + SIWE_EXPIRY_MS).toISOString(),
    });

    let signature: string;
    try {
      const result = await signSolanaMessage(message, svmKey);
      signature = result.signature;
    } catch (err) {
      throw new AuthenticationError(
        `Failed to sign SIWS message: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    return this.postAuth('SVM', message, signature);
  }

  // ── Common ──────────────────────────────────────────────────

  private async postAuth(
    chainType: ChainType,
    message: string,
    signature: string,
  ): Promise<AuthSuccess> {
    const { data, status } = await this.http.post<AuthSuccess>(ENDPOINTS.AUTH, {
      chainType,
      message,
      signature,
    });

    if (status !== 200) {
      throw new AuthenticationError(
        `Authentication failed with status ${status}`,
        data,
      );
    }

    assertShape<AuthSuccess>(data, ['token', 'expiresIn', 'wallet', 'chainType'], 'auth');

    this.session = {
      token: data.token,
      expiresAt: Date.now() + data.expiresIn * 1000,
      wallet: data.wallet,
      chainType: data.chainType,
      tier: data.tier,
    };
    this.http.setToken(data.token);

    return data;
  }

  private async resolveWalletClient(): Promise<WalletClient<Transport, Chain, Account>> {
    if (this.wallet) return this.wallet;

    if (this.privateKey) {
      const { createWalletClient, http } = await import('viem');
      const { privateKeyToAccount } = await import('viem/accounts');
      const { mainnet } = await import('viem/chains');

      const account = privateKeyToAccount(this.privateKey);
      this.wallet = createWalletClient({
        account,
        chain: mainnet,
        transport: http(),
      });
      return this.wallet;
    }

    throw new AuthenticationError(
      'No wallet or privateKey provided. Pass either a viem WalletClient or a hex privateKey.',
    );
  }
}
