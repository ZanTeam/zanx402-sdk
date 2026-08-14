import type { Account, Chain, Transport, WalletClient } from 'viem';
import type { AuthSuccess, AuthSession, NonceResponse } from '../types/auth.js';
import type { ChainType, EvmMessageSigner, SvmSigner } from '../types/common.js';
import { HttpClient, assertShape } from '../utils/http.js';
import { buildSiweMessage } from '../utils/siwe.js';
import { buildSiwsMessage, signSolanaMessage } from '../utils/siws.js';
import { ENDPOINTS, JWT_REFRESH_BUFFER_MS, DEFAULT_STATEMENT } from '../constants.js';
import { AuthenticationError } from '../errors/index.js';

export class AuthModule {
  private readonly http: HttpClient;
  private readonly gatewayUrl: string;
  private readonly origin: string;
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
    origin?: string,
  ) {
    this.http = http;
    this.gatewayUrl = gatewayUrl;
    this.origin = origin ?? gatewayUrl;
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

  async authenticate(): Promise<AuthSuccess> {
    if (this.chainType === 'SVM') {
      return this.authenticateSvm();
    }
    return this.authenticateEvm();
  }

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

  _borrowSvmPrivateKey(): string | undefined {
    if (!this._svmPrivateKey) return undefined;
    return new TextDecoder().decode(this._svmPrivateKey);
  }

  _getSvmSigner(): SvmSigner | undefined {
    return this.svmSigner;
  }

  _borrowEvmPrivateKey(): `0x${string}` | undefined {
    return this.privateKey;
  }

  _getEvmWallet(): WalletClient<Transport, Chain, Account> | undefined {
    return this.wallet;
  }

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

  // ── Nonce challenge ─────────────────────────────────────────

  private async fetchNonce(chainId: string): Promise<NonceResponse> {
    const qs = this.http.buildQueryString({
      chainType: this.chainType,
      origin: this.origin,
      chainId,
    });
    const { data, status } = await this.http.get<NonceResponse>(`${ENDPOINTS.AUTH_NONCE}${qs}`);
    if (status !== 200) {
      throw new AuthenticationError(
        `Failed to get auth nonce: status ${status}`,
        data,
      );
    }
    assertShape<NonceResponse>(data, ['nonce', 'domain', 'uri', 'chainId', 'issuedAt'], 'nonce');
    return data;
  }

  // ── EVM (SIWE) ──────────────────────────────────────────────

  private async authenticateEvm(): Promise<AuthSuccess> {
    const chainId = await this.resolveEvmChainId();
    const challenge = await this.fetchNonce(String(chainId));

    const address = await this.resolveEvmAddress();

    const message = buildSiweMessage({
      domain: challenge.domain,
      address,
      uri: challenge.uri,
      nonce: challenge.nonce,
      chainId: parseInt(challenge.chainId, 10),
      statement: this.statement,
      issuedAt: challenge.issuedAt,
    });

    let signature: string;
    try {
      signature = await this.signEvmMessage(message);
    } catch (err) {
      throw new AuthenticationError(
        `Failed to sign SIWE message: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    return this.postAuth('EVM', message, signature);
  }

  private async resolveEvmChainId(): Promise<number> {
    if (this.evmSigner?.getChainId) return this.evmSigner.getChainId();
    const walletClient = await this.resolveWalletClient();
    return walletClient.chain?.id ?? 1;
  }

  private async resolveEvmAddress(): Promise<`0x${string}`> {
    if (this.evmSigner) return this.evmSigner.address;
    const walletClient = await this.resolveWalletClient();
    return walletClient.account.address;
  }

  private async signEvmMessage(message: string): Promise<string> {
    if (this.evmSigner) {
      return this.evmSigner.signMessage({ message });
    }
    const walletClient = await this.resolveWalletClient();
    return walletClient.signMessage({ message });
  }

  // ── SVM (SIWS) ──────────────────────────────────────────────

  private async authenticateSvm(): Promise<AuthSuccess> {
    const svmChainId = 'solana:mainnet';
    const challenge = await this.fetchNonce(svmChainId);

    const publicKey = await this.resolveSvmPublicKey();

    const message = buildSiwsMessage({
      domain: challenge.domain,
      address: publicKey,
      uri: challenge.uri,
      nonce: challenge.nonce,
      chainId: challenge.chainId,
      statement: this.statement,
      issuedAt: challenge.issuedAt,
    });

    let signature: string;
    try {
      signature = await this.signSvmMessage(message);
    } catch (err) {
      throw new AuthenticationError(
        `Failed to sign SIWS message: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    return this.postAuth('SVM', message, signature);
  }

  private async resolveSvmPublicKey(): Promise<string> {
    if (this.svmSigner) return this.svmSigner.publicKey;
    const svmKey = this._borrowSvmPrivateKey();
    if (!svmKey) {
      throw new AuthenticationError('No svmPrivateKey or svmSigner provided for SVM authentication.');
    }
    const { publicKey } = await signSolanaMessage('ping', svmKey);
    return publicKey;
  }

  private async signSvmMessage(message: string): Promise<string> {
    if (this.svmSigner) {
      const result = await this.svmSigner.signMessage(message);
      return result.signature;
    }
    const svmKey = this._borrowSvmPrivateKey()!;
    const result = await signSolanaMessage(message, svmKey);
    return result.signature;
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
