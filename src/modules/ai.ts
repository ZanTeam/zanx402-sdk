import type {
  AiChatRequest,
  AiChatResponse,
  AiCallOptions,
  AiModelListResponse,
  AiDiscoveryResponse,
  AiCallHistoryParams,
  AiCallHistoryResponse,
  AiCallDetail,
  AiCallStatsParams,
  AiCallStatsResponse,
} from '../types/ai.js';
import type { PaymentRequiredPayload } from '../types/credits.js';
import type { AuthModule } from './auth.js';
import { HttpClient, assertShape, extractTraceId } from '../utils/http.js';
import { AI_ENDPOINTS, DEFAULT_AI_TIMEOUT, HEADERS } from '../constants.js';
import { parsePaymentRequired, encodePaymentSignature } from '../utils/x402.js';
import { buildSolanaX402PaymentPayload, pickSolanaPaymentOption } from '../utils/solana-x402-payment.js';
import { buildEvmX402PaymentPayload, pickEvmPaymentOption } from '../utils/evm-x402-payment.js';
import {
  AiModelNotFoundError,
  AiUpstreamError,
  AiPaymentRequiredError,
  X402Error,
} from '../errors/index.js';

export class AiModule {
  private readonly http: HttpClient;
  private readonly auth: AuthModule;
  private readonly autoPayment: boolean;
  private readonly aiTimeout: number;
  private readonly paymentNetwork?: string;
  private readonly solanaRpcUrl?: string;
  private readonly gatewayUrl?: string;

  constructor(
    http: HttpClient,
    auth: AuthModule,
    opts: {
      autoPayment: boolean;
      aiTimeout?: number;
      paymentNetwork?: string;
      solanaRpcUrl?: string;
      gatewayUrl?: string;
    },
  ) {
    this.http = http;
    this.auth = auth;
    this.autoPayment = opts.autoPayment;
    this.aiTimeout = opts.aiTimeout ?? DEFAULT_AI_TIMEOUT;
    this.paymentNetwork = opts.paymentNetwork;
    this.solanaRpcUrl = opts.solanaRpcUrl;
    this.gatewayUrl = opts.gatewayUrl;
  }

  async chat(
    model: string,
    request: AiChatRequest,
    options?: AiCallOptions,
  ): Promise<AiChatResponse> {
    await this.auth.ensureAuthenticated();

    const path = `${AI_ENDPOINTS.CHAT}/${encodeURIComponent(model)}`;
    const timeout = options?.timeout ?? this.aiTimeout;

    if (options?.paymentSignature) {
      return this.doAiCall(path, request, options.paymentSignature, timeout);
    }

    const initResponse = await this.http.post<Record<string, unknown>>(path, request, { timeout });

    if (initResponse.status === 200) {
      return this.parseAiResponse(initResponse.data, initResponse.headers);
    }

    if (initResponse.status === 402) {
      if (!this.autoPayment) {
        const paymentRequired = parsePaymentRequired(initResponse.headers);
        throw new AiPaymentRequiredError(model, paymentRequired);
      }

      const paymentRequired = parsePaymentRequired(initResponse.headers);
      if (!paymentRequired || paymentRequired.accepts.length === 0) {
        throw new X402Error(
          '402 received but no payment options available',
          'PAYMENT_OPTIONS_EMPTY',
          402,
        );
      }

      const signature = await this.buildPaymentSignature(paymentRequired);
      return this.doAiCall(path, request, signature, timeout);
    }

    return this.handleAiError(model, initResponse.status, initResponse.data, initResponse.headers);
  }

  async listModels(): Promise<AiModelListResponse> {
    const { data } = await this.http.get<AiModelListResponse>(AI_ENDPOINTS.MODELS);
    return data;
  }

  async discover(): Promise<AiDiscoveryResponse> {
    const { data } = await this.http.get<AiDiscoveryResponse>(AI_ENDPOINTS.DISCOVERY);
    return data;
  }

  async getCallHistory(params: AiCallHistoryParams = {}): Promise<AiCallHistoryResponse> {
    await this.auth.ensureAuthenticated();
    const qs = this.http.buildQueryString({
      modelId: params.modelId,
      status: params.status,
      startTime: params.startTime,
      endTime: params.endTime,
      page: params.page,
      size: params.size,
    });
    const { data } = await this.http.get<AiCallHistoryResponse>(`${AI_ENDPOINTS.CALLS}${qs}`);
    return data;
  }

  async getCallDetail(callId: string | number): Promise<AiCallDetail> {
    await this.auth.ensureAuthenticated();
    const { data } = await this.http.get<AiCallDetail>(
      `${AI_ENDPOINTS.CALLS}/${encodeURIComponent(String(callId))}`,
    );
    return data;
  }

  async getCallStats(params: AiCallStatsParams = {}): Promise<AiCallStatsResponse> {
    await this.auth.ensureAuthenticated();
    const qs = this.http.buildQueryString({
      groupBy: params.groupBy,
      startTime: params.startTime,
      endTime: params.endTime,
    });
    const { data } = await this.http.get<AiCallStatsResponse>(`${AI_ENDPOINTS.CALLS_STATS}${qs}`);
    return data;
  }

  // ── Private ────────────────────────────────────────────

  private async doAiCall(
    path: string,
    request: AiChatRequest,
    paymentSignature: string,
    timeout: number,
  ): Promise<AiChatResponse> {
    const { data, status, headers } = await this.http.post<Record<string, unknown>>(
      path,
      request,
      {
        headers: { [HEADERS.PAYMENT_SIGNATURE]: paymentSignature },
        timeout,
      },
    );

    if (status === 200) {
      return this.parseAiResponse(data, headers);
    }

    const model = decodeURIComponent(path.replace(`${AI_ENDPOINTS.CHAT}/`, ''));
    return this.handleAiError(model, status, data, headers);
  }

  private parseAiResponse(data: unknown, headers: Headers): AiChatResponse {
    const body = data as Record<string, unknown>;
    assertShape<AiChatResponse>(body, ['success', 'data'], 'ai-chat');

    const traceId = extractTraceId(headers, data);
    const response = body as unknown as AiChatResponse;
    if (traceId) {
      (response as { traceId?: string }).traceId = traceId;
    }
    return response;
  }

  private async buildPaymentSignature(paymentRequired: PaymentRequiredPayload): Promise<string> {
    const chainType = this.auth.getChainType();

    if (chainType === 'SVM') {
      const option = pickSolanaPaymentOption(paymentRequired.accepts, this.paymentNetwork);
      if (!option) {
        throw new X402Error('No compatible Solana payment option found', 'PAYMENT_OPTION_MISMATCH', 402);
      }
      const svmSigner = this.auth._getSvmSigner();
      const svmKey = this.auth._borrowSvmPrivateKey();
      if (!svmSigner && !svmKey) {
        throw new X402Error('No SVM credentials available for payment', 'NO_SVM_CREDENTIALS', 402);
      }
      const payload = await buildSolanaX402PaymentPayload({
        svmSecretKeyBase58: svmKey,
        svmSigner,
        option,
        solanaRpcUrl: this.solanaRpcUrl,
        gatewayUrl: this.gatewayUrl,
        fetchFn: this.http.getFetchFn(),
      });
      return encodePaymentSignature(payload);
    }

    // EVM
    const option = pickEvmPaymentOption(paymentRequired.accepts, this.paymentNetwork);
    if (!option) {
      throw new X402Error('No compatible EVM payment option found', 'PAYMENT_OPTION_MISMATCH', 402);
    }
    const privateKey = this.auth._borrowEvmPrivateKey();
    const walletClient = this.auth._getEvmWallet();
    if (!privateKey && !walletClient) {
      throw new X402Error('No EVM credentials available for payment', 'NO_EVM_CREDENTIALS', 402);
    }
    const payload = await buildEvmX402PaymentPayload({
      privateKey,
      walletClient,
      option,
    });
    return encodePaymentSignature(payload);
  }

  private handleAiError(
    model: string,
    status: number,
    data: unknown,
    headers: Headers,
  ): never {
    const traceId = extractTraceId(headers, data);
    const body = data as Record<string, unknown>;
    const error = body?.error as Record<string, unknown> | string | undefined;
    const message = typeof error === 'object'
      ? (error?.message as string) ?? `AI request failed with status ${status}`
      : (body?.message as string) ?? `AI request failed with status ${status}`;

    switch (status) {
      case 400:
        throw new X402Error(message, 'INVALID_REQUEST', 400, body, traceId);
      case 404:
        throw new AiModelNotFoundError(model, traceId);
      case 502:
      case 504:
        throw new AiUpstreamError(message, status, traceId);
      default:
        throw new X402Error(
          message,
          typeof error === 'object' ? (error?.code as string) ?? 'AI_ERROR' : 'AI_ERROR',
          status,
          body,
          traceId,
        );
    }
  }
}
