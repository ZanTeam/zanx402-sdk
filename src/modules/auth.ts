import type { Account, Chain, Transport, WalletClient } from 'viem';
import type { AuthSuccess, AuthSession } from '../types/auth.js';
import type { ChainType, EvmMessageSigner, SvmSigner } from '../types/common.js';
import { HttpClient, assertShape } from '../utils/http.js';
import { buildSiweMessage, extractDomain, generateNonce } from '../utils/siwe.js';
import { buildSiwsMessage, signSolanaMessage } from '../utils/siws.js';
import { ENDPOINTS, JWT_REFRESH_BUFFER_MS, SIWE_EXPIRY_MS, DEFAULT_STATEMENT } from '../constants.js';
import { AuthenticationError, SessionExpiredError } from '../errors/index.js';

export class AuthModule {
  private readonly http: HttpClient;
  private readonly gatewayUrl: string;
  private readonly statement: string;
  private session?: AuthSession;
  private wallet?: WalletClient<Transport, Chain, Account>;
  private privateKey?: `0x${string}`;
  private evmSigner?: EvmMessageSigner;
  private _svmPrivateKey?: Uint8Array;
  private svmSigner?: SvmSigner;
  private chainType: ChainType;
  private authPromise?: Promise<AuthSuccess>;

  constructor(
    http: HttpClient,
    gatewayUrl: string,
    chainType: ChainType = 'EVM',
    wallet?: WalletClient<Transport, Chain, Account>,
    privateKey?: `0x${string}`,
    svmPrivateKey?: string,
    evmSigner?: EvmMessageSigner,
    svmSigner?: SvmSigner,
    statement?: string,
  ) {
    this.http = http;
    this.gatewayUrl = gatewayUrl;
    this.chainType = chainType;
    this.wallet = wallet;
    this.privateKey = privateKey;
    this.evmSigner = evmSigner;
    this.svmSigner = svmSigner;
    this.statement = statement ?? DEFAULT_STATEMENT;
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

  getSession(): AuthSession | undefined {
    return this.session;
  }

  isExpiringSoon(): boolean {
    if (!this.session) return true;
    return Date.now() >= this.session.expiresAt - JWT_REFRESH_BUFFER_MS;
  }

  isExpired(): boolean {
    if (!this.session) return true;
    return Date.now() >= this.session.expiresAt;
  }

  clearSession(): void {
    this.session = undefined;
    this.http.setToken(undefined);
  }

  getChainType(): ChainType {
    return this.chainType;
  }

  /** @internal CreditsModule only — returns Base58 key, should not be cached. */
  _borrowSvmPrivateKey(): string | undefined {
    if (!this._svmPrivateKey) return undefined;
    return new TextDecoder().decode(this._svmPrivateKey);
  }

  /** @internal CreditsModule only — returns SvmSigner if available. */
  _getSvmSigner(): SvmSigner | undefined {
    return this.svmSigner;
  }

  /** Inject a session token from an external source (e.g. settlement response). */
  injectSession(token: string, expiresAt: number, wallet?: string): void {
    this.session = {
      token,
      expiresAt,
      wallet: wallet ?? this.session?.wallet ?? '',
      chainType: this.chainType,
      tier: this.session?.tier ?? 'trial',
    };
    this.http.setToken(token);
  }

  /** Wipe all private key material from memory. */
  destroy(): void {
    this.privateKey = undefined;
    if (this._svmPrivateKey) {
      this._svmPrivateKey.fill(0);
      this._svmPrivateKey = undefined;
    }
    this.evmSigner = undefined;
    this.svmSigner = undefined;
    this.clearSession();
  }

  // ── EVM (SIWE) ──────────────────────────────────────────────

  private async authenticateEvm(): Promise<AuthSuccess> {
    const domain = extractDomain(this.gatewayUrl);
    const nonce = generateNonce();

    if (this.evmSigner) {
      return this.authenticateWithEvmSigner(this.evmSigner, domain, nonce);
    }

    const walletClient = await this.resolveWalletClient();
    const address = walletClient.account.address;

    const message = buildSiweMessage({
      domain,
      address,
      uri: this.gatewayUrl,
      nonce,
      chainId: await walletClient.getChainId(),
      statement: this.statement,
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

  private async authenticateWithEvmSigner(
    signer: EvmMessageSigner,
    domain: string,
    nonce: string,
  ): Promise<AuthSuccess> {
    const chainId = signer.getChainId ? await signer.getChainId() : 1;
    const message = buildSiweMessage({
      domain,
      address: signer.address,
      uri: this.gatewayUrl,
      nonce,
      chainId,
      statement: this.statement,
      expirationTime: new Date(Date.now() + SIWE_EXPIRY_MS).toISOString(),
    });

    let signature: string;
    try {
      signature = await signer.signMessage({ message });
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
    if (this.svmSigner) {
      return this.authenticateWithSvmSigner(this.svmSigner);
    }

    const svmKey = this._borrowSvmPrivateKey();
    if (!svmKey) {
      throw new AuthenticationError(
        'No svmPrivateKey or svmSigner provided for SVM authentication.',
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
      statement: this.statement,
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

  private async authenticateWithSvmSigner(signer: SvmSigner): Promise<AuthSuccess> {
    const domain = extractDomain(this.gatewayUrl);
    const nonce = generateNonce();

    const message = buildSiwsMessage({
      domain,
      address: signer.publicKey,
      uri: this.gatewayUrl,
      nonce,
      chainId: 'mainnet',
      statement: this.statement,
      expirationTime: new Date(Date.now() + SIWE_EXPIRY_MS).toISOString(),
    });

    let signature: string;
    try {
      const result = await signer.signMessage(message);
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
      'No wallet, privateKey, or evmSigner provided for EVM authentication.',
    );
  }
}
