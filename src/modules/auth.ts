import type { Account, Chain, Transport, WalletClient } from 'viem';
import type { AuthSuccess, AuthSession } from '../types/auth.js';
import type { ChainType } from '../types/common.js';
import { HttpClient } from '../utils/http.js';
import { buildSiweMessage, extractDomain, generateNonce } from '../utils/siwe.js';
import { buildSiwsMessage, signSolanaMessage } from '../utils/siws.js';
import { ENDPOINTS, JWT_REFRESH_BUFFER_MS } from '../constants.js';
import { AuthenticationError, SessionExpiredError } from '../errors/index.js';

export class AuthModule {
  private readonly http: HttpClient;
  private readonly gatewayUrl: string;
  private session?: AuthSession;
  private wallet?: WalletClient<Transport, Chain, Account>;
  private privateKey?: `0x${string}`;
  private svmPrivateKey?: string;
  private chainType: ChainType;

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
    this.svmPrivateKey = svmPrivateKey;
  }

  /** Authenticate using SIWE (EVM) or SIWS (Solana) and store session JWT */
  async authenticate(): Promise<AuthSuccess> {
    if (this.chainType === 'SVM') {
      return this.authenticateSvm();
    }
    return this.authenticateEvm();
  }

  /** Ensure we have a valid session, re-authenticating if needed */
  async ensureAuthenticated(): Promise<void> {
    if (!this.session || this.isExpiringSoon()) {
      await this.authenticate();
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
    if (!this.svmPrivateKey) {
      throw new AuthenticationError(
        'No svmPrivateKey provided. Pass a Base58-encoded Solana secret key for SIWS authentication.',
      );
    }

    const { publicKey } = await signSolanaMessage('ping', this.svmPrivateKey);

    const domain = extractDomain(this.gatewayUrl);
    const nonce = generateNonce();

    const message = buildSiwsMessage({
      domain,
      address: publicKey,
      uri: this.gatewayUrl,
      nonce,
      chainId: 'mainnet',
      statement: 'Sign in to x402 Gateway Platform',
    });

    let signature: string;
    try {
      const result = await signSolanaMessage(message, this.svmPrivateKey);
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
