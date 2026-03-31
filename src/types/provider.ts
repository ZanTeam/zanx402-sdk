export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string;
  method: string;
  params?: unknown[];
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: JsonRpcError;
  /** Gateway trace identifier — propagated from response header `x-trace-id`. */
  traceId?: string;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ProviderCallOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}
