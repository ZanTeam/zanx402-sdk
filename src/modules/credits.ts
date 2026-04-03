import type {
  BalanceResponse,
  PurchaseSuccess,
  UsageResponse,
  UsageQueryParams,
  PaymentStatus,
  PaymentRequiredPayload,
} from '../types/credits.js';
import type { BundleType } from '../types/common.js';
import { HttpClient, assertShape, extractTraceId } from '../utils/http.js';
import { ENDPOINTS, HEADERS } from '../constants.js';
import { InsufficientCreditsError, PaymentRejectedError, X402Error } from '../errors/index.js';
import { parsePaymentRequired, encodePaymentSignature } from '../utils/x402.js';
import { buildSolanaX402PaymentPayload, pickSolanaPaymentOption } from '../utils/solana-x402-payment.js';
import { buildEvmX402PaymentPayload, pickEvmPaymentOption } from '../utils/evm-x402-payment.js';
import type { AuthModule } from './auth.js';

export class CreditsModule {
  private readonly http: HttpClient;
  private readonly auth: AuthModule;
  private readonly paymentNetwork?: string;
  private readonly solanaRpcUrl?: string;

  constructor(
    http: HttpClient,
    auth: AuthModule,
    opts?: { paymentNetwork?: string; solanaRpcUrl?: string },
  ) {
    this.http = http;
    this.auth = auth;
    this.paymentNetwork = opts?.paymentNetwork;
    this.solanaRpcUrl = opts?.solanaRpcUrl;
  }

  private finalizePurchaseSuccess(data: unknown): PurchaseSuccess {
    assertShape<PurchaseSuccess>(data, ['success', 'bundle', 'balance'], 'purchase');
    return data as PurchaseSuccess;
  }

  /**
   * When 402 + SVM credentials present: build SPL USDC tx, sign, complete purchase.
   * Supports both raw private key and abstract SvmSigner.
   */
  private async tryCompleteSolanaPurchase(
    path: string,
    paymentRequired: PaymentRequiredPayload,
    idempotencyKey: string,
  ): Promise<PurchaseSuccess | null> {
    if (this.auth.getChainType() !== 'SVM') {
      return null;
    }

    const option = pickSolanaPaymentOption(paymentRequired.accepts, this.paymentNetwork);
    if (!option) {
      return null;
    }

    const svmSigner = this.auth._getSvmSigner();
    const svmKey = this.auth._borrowSvmPrivateKey();
    if (!svmSigner && !svmKey) {
      return null;
    }

    const payload = await buildSolanaX402PaymentPayload({
      svmSecretKeyBase58: svmKey,
      svmSigner,
      option,
      solanaRpcUrl: this.solanaRpcUrl,
    });
    const header = encodePaymentSignature(payload);
    return this.completePurchase(path, header, idempotencyKey);
  }

  /**
   * When 402 + EVM credentials present: sign EIP-3009 transferWithAuthorization, complete purchase.
   * Supports both raw private key and viem WalletClient.
   */
  private async tryCompleteEvmPurchase(
    path: string,
    paymentRequired: PaymentRequiredPayload,
    idempotencyKey: string,
  ): Promise<PurchaseSuccess | null> {
    if (this.auth.getChainType() !== 'EVM') return null;

    const option = pickEvmPaymentOption(paymentRequired.accepts, this.paymentNetwork);
    if (!option) return null;

    const privateKey = this.auth._borrowEvmPrivateKey();
    const walletClient = this.auth._getEvmWallet();
    if (!privateKey && !walletClient) return null;

    const payload = await buildEvmX402PaymentPayload({
      privateKey,
      walletClient,
      option,
    });
    const header = encodePaymentSignature(payload);
    return this.completePurchase(path, header, idempotencyKey);
  }

  /** Get current credit balance */
  async getBalance(): Promise<BalanceResponse> {
    await this.auth.ensureAuthenticated();
    const { data, status, headers } = await this.http.get<BalanceResponse>(ENDPOINTS.BALANCE);
    if (status !== 200) {
      const traceId = extractTraceId(headers, data);
      throw new X402Error(`Failed to get balance: status ${status}`, 'BALANCE_ERROR', status, data, traceId);
    }
    assertShape<BalanceResponse>(data, ['wallet', 'balance'], 'balance');
    return data;
  }

  /**
   * Purchase credits via x402 payment flow.
   * 1. POST /credits/purchase/{bundle} without signature → 402 + PAYMENT-REQUIRED
   * 2. Construct EIP-3009 payment signature from wallet
   * 3. Retry with PAYMENT-SIGNATURE header → 200 + credits topped up
   */
  async purchaseCredits(bundle: BundleType = 'default', paymentSignature?: string): Promise<PurchaseSuccess> {
    await this.auth.ensureAuthenticated();

    const path = `${ENDPOINTS.PURCHASE}/${bundle}`;
    const idempotencyKey = globalThis.crypto.randomUUID();

    if (paymentSignature) {
      return this.completePurchase(path, paymentSignature, idempotencyKey);
    }

    const initResponse = await this.http.post<PurchaseSuccess>(path, undefined, {
      headers: { [HEADERS.IDEMPOTENCY_KEY]: idempotencyKey },
    });
    const initTraceId = extractTraceId(initResponse.headers, initResponse.data);

    if (initResponse.status === 200) {
      return this.finalizePurchaseSuccess(initResponse.data);
    }

    if (initResponse.status !== 402) {
      throw new X402Error(
        `Unexpected response from purchase: ${initResponse.status}`,
        'PURCHASE_ERROR',
        initResponse.status,
        initResponse.data,
        initTraceId,
      );
    }

    const paymentRequired = parsePaymentRequired(initResponse.headers);
    if (!paymentRequired || paymentRequired.accepts.length === 0) {
      throw new PaymentRejectedError('402 received but no payment options available');
    }

    const solCompleted = await this.tryCompleteSolanaPurchase(path, paymentRequired, idempotencyKey);
    if (solCompleted) return solCompleted;

    const evmCompleted = await this.tryCompleteEvmPurchase(path, paymentRequired, idempotencyKey);
    if (evmCompleted) return evmCompleted;

    return {
      ...initResponse.data,
      _paymentRequired: paymentRequired,
    } as PurchaseSuccess & { _paymentRequired: typeof paymentRequired };
  }

  /**
   * Complete a purchase with a pre-built payment signature.
   * Typically called after the wallet has signed the EIP-3009 authorization.
   */
  async completePurchase(
    path: string,
    paymentSignature: string,
    idempotencyKey?: string,
  ): Promise<PurchaseSuccess> {
    const reqHeaders: Record<string, string> = {
      [HEADERS.PAYMENT_SIGNATURE]: paymentSignature,
    };
    if (idempotencyKey) {
      reqHeaders[HEADERS.IDEMPOTENCY_KEY] = idempotencyKey;
    }
    const { data, status, headers } = await this.http.post<PurchaseSuccess>(path, undefined, {
      headers: reqHeaders,
    });

    const traceId = extractTraceId(headers, data);

    if (status !== 200) {
      const body = data as unknown as Record<string, unknown> | undefined;
      const reason = (body?.error as string) ?? (body?.message as string) ?? `status ${status}`;
      const detailStr = (body?.details as string) ?? (body?.reason as string) ?? '';
      const hint = detailStr ? ` (${detailStr})` : '';
      throw new PaymentRejectedError(`Payment rejected: ${reason}${hint}`, undefined, traceId, body);
    }

    return this.finalizePurchaseSuccess(data);
  }

  /** Query usage records */
  async getUsage(params: UsageQueryParams = {}): Promise<UsageResponse> {
    await this.auth.ensureAuthenticated();
    const qs = this.http.buildQueryString({
      limit: params.limit,
      offset: params.offset,
      provider: params.provider,
    });
    const { data, status, headers } = await this.http.get<UsageResponse>(`${ENDPOINTS.USAGE}${qs}`);
    if (status !== 200) {
      const traceId = extractTraceId(headers, data);
      throw new X402Error(`Failed to get usage: status ${status}`, 'USAGE_ERROR', status, data, traceId);
    }
    return data;
  }

  /** Query a specific payment status by idempotency key */
  async getPaymentStatus(idempotencyKey: string): Promise<PaymentStatus> {
    await this.auth.ensureAuthenticated();
    const { data, status, headers } = await this.http.get<PaymentStatus>(
      `${ENDPOINTS.PAYMENT_STATUS}/${encodeURIComponent(idempotencyKey)}`,
    );
    if (status !== 200) {
      const traceId = extractTraceId(headers, data);
      throw new X402Error(`Failed to get payment status: ${status}`, 'PAYMENT_STATUS_ERROR', status, data, traceId);
    }
    return data;
  }
}
