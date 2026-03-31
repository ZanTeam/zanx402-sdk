import type {
  BalanceResponse,
  PurchaseSuccess,
  UsageResponse,
  UsageQueryParams,
  PaymentStatus,
  PaymentRequiredPayload,
} from '../types/credits.js';
import type { BundleType } from '../types/common.js';
import { HttpClient, assertShape } from '../utils/http.js';
import { ENDPOINTS, HEADERS } from '../constants.js';
import { InsufficientCreditsError, PaymentRejectedError, X402Error } from '../errors/index.js';
import { parsePaymentRequired, encodePaymentSignature } from '../utils/x402.js';
import { buildSolanaX402PaymentPayload, pickSolanaPaymentOption } from '../utils/solana-x402-payment.js';
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

  /**
   * When 402 + SVM key present: build SPL USDC tx, sign, complete purchase via facilitator.
   */
  private async tryCompleteSolanaPurchase(
    path: string,
    paymentRequired: PaymentRequiredPayload,
  ): Promise<PurchaseSuccess | null> {
    if (this.auth.getChainType() !== 'SVM') return null;
    const svm = this.auth._borrowSvmPrivateKey();
    if (!svm) return null;
    const option = pickSolanaPaymentOption(paymentRequired.accepts, this.paymentNetwork);
    if (!option) return null;
    const payload = await buildSolanaX402PaymentPayload({
      svmSecretKeyBase58: svm,
      option,
      solanaRpcUrl: this.solanaRpcUrl,
    });
    const header = encodePaymentSignature(payload);
    return this.completePurchase(path, header);
  }

  /** Get current credit balance */
  async getBalance(): Promise<BalanceResponse> {
    await this.auth.ensureAuthenticated();
    const { data, status } = await this.http.get<BalanceResponse>(ENDPOINTS.BALANCE);
    if (status !== 200) {
      throw new X402Error(`Failed to get balance: status ${status}`, 'BALANCE_ERROR', status, data);
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

    if (paymentSignature) {
      return this.completePurchase(path, paymentSignature);
    }

    const initResponse = await this.http.post<PurchaseSuccess>(path);

    if (initResponse.status === 200) {
      return initResponse.data;
    }

    if (initResponse.status !== 402) {
      throw new X402Error(
        `Unexpected response from purchase: ${initResponse.status}`,
        'PURCHASE_ERROR',
        initResponse.status,
        initResponse.data,
      );
    }

    const paymentRequired = parsePaymentRequired(initResponse.headers);
    if (!paymentRequired || paymentRequired.accepts.length === 0) {
      throw new PaymentRejectedError('402 received but no payment options available');
    }

    const completed = await this.tryCompleteSolanaPurchase(path, paymentRequired);
    if (completed) return completed;

    return {
      ...initResponse.data,
      _paymentRequired: paymentRequired,
    } as PurchaseSuccess & { _paymentRequired: typeof paymentRequired };
  }

  /**
   * Complete a purchase with a pre-built payment signature.
   * Typically called after the wallet has signed the EIP-3009 authorization.
   */
  async completePurchase(path: string, paymentSignature: string): Promise<PurchaseSuccess> {
    const { data, status } = await this.http.post<PurchaseSuccess>(path, undefined, {
      headers: { [HEADERS.PAYMENT_SIGNATURE]: paymentSignature },
    });

    if (status !== 200) {
      const body = data as unknown as Record<string, unknown> | undefined;
      const reason = (body?.error as string) ?? (body?.message as string) ?? `status ${status}`;
      throw new PaymentRejectedError(`Payment rejected: ${reason}`);
    }

    assertShape<PurchaseSuccess>(data, ['success', 'bundle', 'balance'], 'purchase');
    return data;
  }

  /** Query usage records */
  async getUsage(params: UsageQueryParams = {}): Promise<UsageResponse> {
    await this.auth.ensureAuthenticated();
    const qs = this.http.buildQueryString({
      limit: params.limit,
      offset: params.offset,
      provider: params.provider,
    });
    const { data, status } = await this.http.get<UsageResponse>(`${ENDPOINTS.USAGE}${qs}`);
    if (status !== 200) {
      throw new X402Error(`Failed to get usage: status ${status}`, 'USAGE_ERROR', status, data);
    }
    return data;
  }

  /** Query a specific payment status by idempotency key */
  async getPaymentStatus(idempotencyKey: string): Promise<PaymentStatus> {
    await this.auth.ensureAuthenticated();
    const { data, status } = await this.http.get<PaymentStatus>(
      `${ENDPOINTS.PAYMENT_STATUS}/${encodeURIComponent(idempotencyKey)}`,
    );
    if (status !== 200) {
      throw new X402Error(`Failed to get payment status: ${status}`, 'PAYMENT_STATUS_ERROR', status, data);
    }
    return data;
  }
}
