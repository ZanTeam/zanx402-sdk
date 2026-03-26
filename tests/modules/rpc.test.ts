import { RpcModule } from '../../src/modules/rpc.js';
import { HttpClient } from '../../src/utils/http.js';
import { InsufficientCreditsError, ProviderNotFoundError } from '../../src/errors/index.js';
import { ENDPOINTS } from '../../src/constants.js';
import type { AuthModule } from '../../src/modules/auth.js';

describe('RpcModule', () => {
  const createMockAuth = () => ({
    ensureAuthenticated: vi.fn().mockResolvedValue(undefined),
  });

  const createMockHttp = () => ({
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    buildQueryString: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('call() builds correct JSON-RPC body with method and params', async () => {
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    const expectedResponse = { jsonrpc: '2.0', id: 1, result: '0x1' };
    mockHttp.post.mockResolvedValue({ data: expectedResponse, status: 200, headers: new Headers() });

    const rpc = new RpcModule(mockHttp, mockAuth);
    await rpc.call('eth', 'mainnet', 'eth_blockNumber', []);

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
      }),
    );
    const body = mockHttp.post.mock.calls[0][1];
    expect(body).toHaveProperty('id');
    expect(typeof body.id).toBe('number');
  });

  it('call() sends to correct path /rpc/{ecosystem}/{network}', async () => {
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.post.mockResolvedValue({ data: { jsonrpc: '2.0', id: 1, result: '0x1' }, status: 200, headers: new Headers() });

    const rpc = new RpcModule(mockHttp, mockAuth);
    await rpc.call('eth', 'mainnet', 'eth_blockNumber');

    const expectedPath = `${ENDPOINTS.RPC}/eth/mainnet`;
    expect(mockHttp.post).toHaveBeenCalledWith(expectedPath, expect.any(Object));
  });

  it('call() calls auth.ensureAuthenticated before request', async () => {
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.post.mockResolvedValue({ data: { jsonrpc: '2.0', id: 1, result: '0x1' }, status: 200, headers: new Headers() });

    const rpc = new RpcModule(mockHttp, mockAuth);
    await rpc.call('eth', 'mainnet', 'eth_blockNumber');

    expect(mockAuth.ensureAuthenticated).toHaveBeenCalled();
  });

  it('call() throws InsufficientCreditsError on 402', async () => {
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.post.mockResolvedValue({
      data: { required: 100, balance: 0, purchaseUrl: 'https://pay.example.com' },
      status: 402,
      headers: new Headers(),
    });

    const rpc = new RpcModule(mockHttp, mockAuth);

    await expect(rpc.call('eth', 'mainnet', 'eth_blockNumber')).rejects.toThrow(InsufficientCreditsError);
    await expect(rpc.call('eth', 'mainnet', 'eth_blockNumber')).rejects.toThrow(/Insufficient credits/);
  });

  it('call() throws ProviderNotFoundError on 404', async () => {
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    const path = `${ENDPOINTS.RPC}/eth/mainnet`;
    mockHttp.post.mockResolvedValue({
      data: { error: 'not_found', message: 'Provider not found' },
      status: 404,
      headers: new Headers(),
    });

    const rpc = new RpcModule(mockHttp, mockAuth);

    await expect(rpc.call('eth', 'mainnet', 'eth_blockNumber')).rejects.toThrow(ProviderNotFoundError);
    await expect(rpc.call('eth', 'mainnet', 'eth_blockNumber')).rejects.toThrow(/No matching provider/);
  });

  it('batch() sends array of JSON-RPC requests', async () => {
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    const expectedResponse = [
      { jsonrpc: '2.0', id: 1, result: '0x1' },
      { jsonrpc: '2.0', id: 2, result: '0x2' },
    ];
    mockHttp.post.mockResolvedValue({ data: expectedResponse, status: 200, headers: new Headers() });

    const rpc = new RpcModule(mockHttp, mockAuth);
    const result = await rpc.batch('eth', 'mainnet', [
      { method: 'eth_blockNumber' },
      { method: 'eth_chainId', params: [] },
    ]);

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [] }),
        expect.objectContaining({ jsonrpc: '2.0', method: 'eth_chainId', params: [] }),
      ]),
    );
    expect(result).toEqual(expectedResponse);
  });

  it('forward() uses request method with custom options', async () => {
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    const expectedData = { result: 'ai-response' };
    mockHttp.request.mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const rpc = new RpcModule(mockHttp, mockAuth);
    const result = await rpc.forward('/api/ai/gpt4', {
      method: 'POST',
      body: { prompt: 'Hello' },
      headers: { 'X-Custom': 'value' },
      timeout: 5000,
    });

    expect(mockHttp.request).toHaveBeenCalledWith(
      '/api/ai/gpt4',
      expect.objectContaining({
        method: 'POST',
        body: { prompt: 'Hello' },
        headers: { 'X-Custom': 'value' },
        timeout: 5000,
      }),
    );
    expect(result).toEqual(expectedData);
  });
});
