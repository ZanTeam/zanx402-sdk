import type { JsonRpcRequest, JsonRpcResponse, ProviderCallOptions } from '../types/provider.js';
import type { InsufficientCreditsBody } from '../types/credits.js';
import { HttpClient, extractTraceId } from '../utils/http.js';
import { ENDPOINTS } from '../constants.js';
import {
  InsufficientCreditsError,
  MethodNotAllowedError,
  ProviderNotFoundError,
  UpstreamError,
  X402Error,
} from '../errors/index.js';
import type { AuthModule } from './auth.js';

export class RpcModule {
  private readonly http: HttpClient;
  private readonly auth: AuthModule;
  private rpcIdCounter = 1;

  private nextId(): number {
    const id = this.rpcIdCounter++;
    if (this.rpcIdCounter > Number.MAX_SAFE_INTEGER) {
      this.rpcIdCounter = 1;
    }
    return id;
  }

  constructor(http: HttpClient, auth: AuthModule) {
    this.http = http;
    this.auth = auth;
  }

  /**
   * Send a JSON-RPC call through the gateway.
   *
   * @example
   * const blockNumber = await rpc.call('eth', 'mainnet', 'eth_blockNumber');
   * const balance = await rpc.call('eth', 'mainnet', 'eth_getBalance', ['0x...', 'latest']);
   */
  async call<T = unknown>(
    ecosystem: string,
    network: string,
    method: string,
    params: unknown[] = [],
  ): Promise<JsonRpcResponse<T>> {
    await this.auth.ensureAuthenticated();

    const path = `${ENDPOINTS.RPC}/${encodeURIComponent(ecosystem)}/${encodeURIComponent(network)}`;
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method,
      params,
    };

    const { data, status, headers } = await this.http.post<JsonRpcResponse<T> | Record<string, unknown>>(
      path,
      body,
    );

    const traceId = extractTraceId(headers, data);
    this.handleErrorStatus(status, path, data, traceId);

    const response = data as JsonRpcResponse<T>;
    if (traceId) response.traceId = traceId;
    return response;
  }

  /**
   * Batch JSON-RPC calls in a single HTTP request.
   */
  async batch<T = unknown>(
    ecosystem: string,
    network: string,
    calls: Array<{ method: string; params?: unknown[] }>,
  ): Promise<Array<JsonRpcResponse<T>>> {
    await this.auth.ensureAuthenticated();

    const path = `${ENDPOINTS.RPC}/${encodeURIComponent(ecosystem)}/${encodeURIComponent(network)}`;
    const body = calls.map((c) => ({
      jsonrpc: '2.0',
      id: this.nextId(),
      method: c.method,
      params: c.params ?? [],
    }));

    const { data, status, headers } = await this.http.post<Array<JsonRpcResponse<T>> | Record<string, unknown>>(
      path,
      body,
    );

    const traceId = extractTraceId(headers, data);
    this.handleErrorStatus(status, path, data, traceId);

    const responses = data as Array<JsonRpcResponse<T>>;
    if (traceId) {
      for (const r of responses) r.traceId = traceId;
    }
    return responses;
  }

  /**
   * Send a generic provider request (non-RPC routes like AI, data APIs).
   *
   * @example
   * const result = await rpc.forward('/api/ai/gpt4', { method: 'POST', body: { prompt: 'Hello' } });
   */
  async forward<T = unknown>(path: string, options: ProviderCallOptions = {}): Promise<T> {
    if (!path.startsWith('/') || path.includes('://') || path.startsWith('//')) {
      throw new X402Error(
        'Invalid forward path: must start with "/" and must not contain "://" or "//"',
        'INVALID_PATH',
        400,
      );
    }
    await this.auth.ensureAuthenticated();

    const { data, status, headers } = await this.http.request<T | Record<string, unknown>>(path, {
      method: options.method ?? 'POST',
      headers: options.headers,
      body: options.body,
      timeout: options.timeout,
    });

    const traceId = extractTraceId(headers, data);
    this.handleErrorStatus(status, path, data, traceId);
    return data as T;
  }

  private handleErrorStatus(status: number, path: string, data: unknown, traceId?: string): void {
    if (status >= 200 && status < 300) return;

    const body = data as Record<string, unknown>;
    const error = (body?.error as string) ?? 'unknown';
    const message = (body?.message as string) ?? `Request failed with status ${status}`;

    switch (status) {
      case 402: {
        const creditsBody = body as unknown as InsufficientCreditsBody;
        throw new InsufficientCreditsError(
          creditsBody.required ?? 0,
          creditsBody.balance ?? 0,
          creditsBody.purchaseUrl,
          traceId,
        );
      }
      case 403:
        throw new MethodNotAllowedError(message, traceId);
      case 404:
        throw new ProviderNotFoundError(path, traceId);
      case 504:
        throw new UpstreamError(message, status, (body?.creditRefunded as boolean) ?? false, traceId);
      default:
        throw new X402Error(message, error, status, body, traceId);
    }
  }
}
