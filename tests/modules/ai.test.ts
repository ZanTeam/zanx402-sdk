import { AiModule } from '../../src/modules/ai.js';
import { HttpClient } from '../../src/utils/http.js';
import {
  AiModelNotFoundError,
  AiUpstreamError,
  AiPaymentRequiredError,
  X402Error,
} from '../../src/errors/index.js';
import { AI_ENDPOINTS, HEADERS } from '../../src/constants.js';
import type { AuthModule } from '../../src/modules/auth.js';

describe('AiModule', () => {
  const createMockAuth = (chainType: 'EVM' | 'SVM' = 'EVM') => ({
    ensureAuthenticated: vi.fn().mockResolvedValue(undefined),
    getChainType: vi.fn().mockReturnValue(chainType),
    _borrowEvmPrivateKey: vi.fn().mockReturnValue('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
    _getEvmWallet: vi.fn().mockReturnValue(undefined),
    _borrowSvmPrivateKey: vi.fn().mockReturnValue(undefined),
    _getSvmSigner: vi.fn().mockReturnValue(undefined),
  });

  const createMockHttp = () => ({
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    buildQueryString: vi.fn((params: Record<string, unknown>) => {
      const entries = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`);
      return entries.length > 0 ? `?${entries.join('&')}` : '';
    }),
  });

  const successResponse = {
    success: true,
    data: {
      model: 'claude-opus-4-6',
      content: 'Hello, world!',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      finish_reason: 'stop',
    },
  };

  const paymentRequiredHeaders = () => {
    const payload = {
      accepts: [{
        network: 'eip155:8453',
        amount: '500000',
        decimals: 6,
        recipient: '0x2222222222222222222222222222222222222222',
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      }],
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    const headers = new Headers();
    headers.set(HEADERS.PAYMENT_REQUIRED, encoded);
    return headers;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('chat()', () => {
    it('returns AI response when server responds 200 directly', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      vi.mocked(mockHttp.post).mockResolvedValue({
        data: successResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      const result = await ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] });

      expect(result.success).toBe(true);
      expect(result.data.content).toBe('Hello, world!');
      expect(result.data.usage.total_tokens).toBe(15);
    });

    it('calls auth.ensureAuthenticated before request', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      vi.mocked(mockHttp.post).mockResolvedValue({
        data: successResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      await ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] });

      expect(mockAuth.ensureAuthenticated).toHaveBeenCalled();
    });

    it('sends request to correct path /ai/{model}', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      vi.mocked(mockHttp.post).mockResolvedValue({
        data: successResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      await ai.chat('gpt-5.5', { messages: [{ role: 'user', content: 'Hi' }] });

      expect(vi.mocked(mockHttp.post)).toHaveBeenCalledWith(
        `${AI_ENDPOINTS.CHAT}/gpt-5.5`,
        expect.objectContaining({ messages: [{ role: 'user', content: 'Hi' }] }),
        expect.any(Object),
      );
    });

    it('handles 402 with autoPayment: retries with PAYMENT-SIGNATURE', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post)
        .mockResolvedValueOnce({
          data: {},
          status: 402,
          headers: paymentRequiredHeaders(),
        })
        .mockResolvedValueOnce({
          data: successResponse,
          status: 200,
          headers: new Headers(),
        });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      const result = await ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] });

      expect(vi.mocked(mockHttp.post)).toHaveBeenCalledTimes(2);
      const secondCallOpts = vi.mocked(mockHttp.post).mock.calls[1][2] as Record<string, unknown>;
      const headers = secondCallOpts.headers as Record<string, string>;
      expect(headers[HEADERS.PAYMENT_SIGNATURE]).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('throws AiPaymentRequiredError on 402 when autoPayment is false', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: {},
        status: 402,
        headers: paymentRequiredHeaders(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: false });

      await expect(
        ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(AiPaymentRequiredError);

      try {
        await ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] });
      } catch (err) {
        expect(err).toBeInstanceOf(AiPaymentRequiredError);
        expect((err as AiPaymentRequiredError).paymentRequired).not.toBeNull();
        expect((err as AiPaymentRequiredError).paymentRequired!.accepts).toHaveLength(1);
      }
    });

    it('sends paymentSignature directly when provided in options', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: successResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: false });
      await ai.chat(
        'claude-opus-4-6',
        { messages: [{ role: 'user', content: 'Hi' }] },
        { paymentSignature: 'my-pre-built-signature' },
      );

      expect(vi.mocked(mockHttp.post)).toHaveBeenCalledTimes(1);
      const opts = vi.mocked(mockHttp.post).mock.calls[0][2] as Record<string, unknown>;
      const headers = opts.headers as Record<string, string>;
      expect(headers[HEADERS.PAYMENT_SIGNATURE]).toBe('my-pre-built-signature');
    });

    it('throws AiModelNotFoundError on 404', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: { success: false, error: { code: 'MODEL_NOT_FOUND', message: 'Not found' } },
        status: 404,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });

      await expect(
        ai.chat('nonexistent', { messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(AiModelNotFoundError);
    });

    it('throws AiUpstreamError on 502', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: { success: false, error: { code: 'UPSTREAM_ERROR', message: 'Provider failed' } },
        status: 502,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });

      await expect(
        ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(AiUpstreamError);
    });

    it('throws AiUpstreamError on 504', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: { success: false, error: { code: 'UPSTREAM_TIMEOUT', message: 'Timeout' } },
        status: 504,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });

      await expect(
        ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(AiUpstreamError);
    });

    it('throws X402Error on 400 (invalid request)', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: { success: false, error: { code: 'INVALID_REQUEST', message: 'Missing messages' } },
        status: 400,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });

      await expect(
        ai.chat('claude-opus-4-6', { messages: [] }),
      ).rejects.toThrow(X402Error);
    });

    it('uses custom timeout from options', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: successResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true, aiTimeout: 60_000 });
      await ai.chat(
        'claude-opus-4-6',
        { messages: [{ role: 'user', content: 'Hi' }] },
        { timeout: 30_000 },
      );

      const opts = vi.mocked(mockHttp.post).mock.calls[0][2] as Record<string, unknown>;
      expect(opts.timeout).toBe(30_000);
    });

    it('uses aiTimeout when options.timeout is not set', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: successResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true, aiTimeout: 90_000 });
      await ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] });

      const opts = vi.mocked(mockHttp.post).mock.calls[0][2] as Record<string, unknown>;
      expect(opts.timeout).toBe(90_000);
    });

    it('propagates traceId from response headers', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      const headers = new Headers();
      headers.set('x-trace-id', 'trace-abc-123');

      vi.mocked(mockHttp.post).mockResolvedValue({
        data: successResponse,
        status: 200,
        headers,
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      const result = await ai.chat('claude-opus-4-6', { messages: [{ role: 'user', content: 'Hi' }] });

      expect(result.traceId).toBe('trace-abc-123');
    });
  });

  describe('listModels()', () => {
    it('returns model list from GET /api/models', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      const modelsResponse = {
        success: true,
        data: [
          { model_name: 'claude-opus-4-6', endpoint: '/ai/claude-opus-4-6', price: 0.5 },
          { model_name: 'gpt-5.5', endpoint: '/ai/gpt-5.5', price: 0.8 },
        ],
      };

      vi.mocked(mockHttp.get).mockResolvedValue({
        data: modelsResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      const result = await ai.listModels();

      expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(AI_ENDPOINTS.MODELS);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].model_name).toBe('claude-opus-4-6');
      expect(result.data[0].price).toBe(0.5);
    });
  });

  describe('discover()', () => {
    it('returns discovery info from GET /v1/discovery/ai', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      const discoveryData = { models: ['claude-opus-4-6'], version: '1.0' };

      vi.mocked(mockHttp.get).mockResolvedValue({
        data: discoveryData,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      const result = await ai.discover();

      expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(AI_ENDPOINTS.DISCOVERY);
      expect(result).toEqual(discoveryData);
    });
  });

  describe('getCallHistory()', () => {
    it('queries call history with params', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      const historyResponse = { records: [], total: 0, page: 0, size: 20 };

      vi.mocked(mockHttp.get).mockResolvedValue({
        data: historyResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      await ai.getCallHistory({ modelId: 'claude-opus-4-6', page: 0, size: 10 });

      expect(mockAuth.ensureAuthenticated).toHaveBeenCalled();
      expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(
        expect.stringContaining(AI_ENDPOINTS.CALLS),
      );
    });
  });

  describe('getCallDetail()', () => {
    it('queries call detail by id', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      const detailResponse = {
        id: 42,
        model: 'claude-opus-4-6',
        status: 'success',
        tokens: 100,
        cost: 0.5,
        createdAt: '2026-06-10T10:00:00Z',
        request: {},
        response: {},
        latencyMs: 1200,
        paymentNetwork: 'eip155:8453',
      };

      vi.mocked(mockHttp.get).mockResolvedValue({
        data: detailResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      const result = await ai.getCallDetail(42);

      expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(`${AI_ENDPOINTS.CALLS}/42`);
      expect(result.id).toBe(42);
    });
  });

  describe('getCallStats()', () => {
    it('queries call stats with groupBy', async () => {
      const mockHttp = createMockHttp();
      const mockAuth = createMockAuth() as unknown as AuthModule;
      const statsResponse = {
        stats: [{ key: 'claude-opus-4-6', totalCalls: 10, totalTokens: 500, totalCost: 5.0, avgLatencyMs: 1500 }],
      };

      vi.mocked(mockHttp.get).mockResolvedValue({
        data: statsResponse,
        status: 200,
        headers: new Headers(),
      });

      const ai = new AiModule(mockHttp as unknown as HttpClient, mockAuth, { autoPayment: true });
      const result = await ai.getCallStats({ groupBy: 'model' });

      expect(mockAuth.ensureAuthenticated).toHaveBeenCalled();
      expect(result.stats).toHaveLength(1);
      expect(result.stats[0].totalCalls).toBe(10);
    });
  });
});
