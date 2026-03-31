import { HEADERS, DEFAULT_TIMEOUT } from '../constants.js';
import { NetworkError, X402Error } from '../errors/index.js';

/**
 * Lightweight runtime check that `obj` has every key in `keys` with a non-undefined value.
 * Used as a minimal guard against malformed gateway responses.
 */
export function assertShape<T>(obj: unknown, keys: string[], label: string): asserts obj is T {
  if (obj == null || typeof obj !== 'object') {
    throw new X402Error(`Invalid ${label} response: expected object, got ${typeof obj}`, 'INVALID_RESPONSE');
  }
  for (const k of keys) {
    if (!(k in (obj as Record<string, unknown>))) {
      throw new X402Error(`Invalid ${label} response: missing field "${k}"`, 'INVALID_RESPONSE');
    }
  }
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly defaultTimeout: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private token?: string;

  constructor(baseUrl: string, timeout = DEFAULT_TIMEOUT, fetchFn?: typeof globalThis.fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultTimeout = timeout;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  getToken(): string | undefined {
    return this.token;
  }

  /** Expose the underlying fetch function for transparent proxy use */
  getFetchFn(): typeof globalThis.fetch {
    return this.fetchFn;
  }

  async request<T>(path: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const method = options.method ?? 'GET';
    const timeout = options.timeout ?? this.defaultTimeout;

    const headers: Record<string, string> = {
      [HEADERS.CONTENT_TYPE]: 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers[HEADERS.AUTHORIZATION] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this.fetchFn(url, {
        method,
        headers,
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      let data: T;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        data = (await response.json()) as T;
      } else {
        data = (await response.text()) as unknown as T;
      }

      return { data, status: response.status, headers: response.headers };
    } catch (err) {
      if (err instanceof X402Error) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new NetworkError(`Request to ${path} timed out after ${timeout}ms`);
      }
      throw new NetworkError(
        `Request to ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async get<T>(path: string, options?: Omit<HttpRequestOptions, 'method'>): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  async post<T>(path: string, body?: unknown, options?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
    const entries = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return entries.length > 0 ? `?${entries.join('&')}` : '';
  }
}
