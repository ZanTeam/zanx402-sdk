import { X402Client } from '../src/client.js';
import { InsufficientCreditsError } from '../src/errors/index.js';

const mockFetch = vi.fn();

describe('X402Client', () => {
  const baseConfig = {
    gatewayUrl: 'https://gateway.test.example.com',
    fetch: mockFetch,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    });
  });

  it('Constructor creates all modules', () => {
    const client = new X402Client(baseConfig);

    expect(client.auth).toBeDefined();
    expect(client.credits).toBeDefined();
    expect(client.rpc).toBeDefined();
    expect(client.discovery).toBeDefined();
  });

  it('call() delegates to rpc.call', async () => {
    const client = new X402Client(baseConfig);
    const expectedResult = { jsonrpc: '2.0', id: 1, result: '0x1' };
    const callSpy = vi.spyOn(client.rpc, 'call').mockResolvedValue(expectedResult);

    const result = await client.call('eth', 'mainnet', 'eth_blockNumber', []);

    expect(callSpy).toHaveBeenCalledWith('eth', 'mainnet', 'eth_blockNumber', []);
    expect(result).toEqual(expectedResult);
  });

  it('call() with autoPayment retries on InsufficientCreditsError', async () => {
    const client = new X402Client({
      ...baseConfig,
      autoPayment: true,
    });
    const expectedResult = { jsonrpc: '2.0', id: 1, result: '0x1' };
    const callSpy = vi
      .spyOn(client.rpc, 'call')
      .mockRejectedValueOnce(new InsufficientCreditsError(100, 0))
      .mockResolvedValueOnce(expectedResult);
    const purchaseSpy = vi
      .spyOn(client.credits, 'purchaseCredits')
      .mockResolvedValue({ success: true } as never);

    const result = await client.call('eth', 'mainnet', 'eth_blockNumber');

    expect(callSpy).toHaveBeenCalledTimes(2);
    expect(purchaseSpy).toHaveBeenCalledWith('default');
    expect(result).toEqual(expectedResult);
  });

  it('forward() delegates to rpc.forward', async () => {
    const client = new X402Client(baseConfig);
    const expectedData = { result: 'forwarded' };
    const forwardSpy = vi.spyOn(client.rpc, 'forward').mockResolvedValue(expectedData);

    const result = await client.forward('/api/custom', { method: 'POST', body: { x: 1 } });

    expect(forwardSpy).toHaveBeenCalledWith('/api/custom', { method: 'POST', body: { x: 1 } });
    expect(result).toEqual(expectedData);
  });

  it('getBalance() delegates to credits.getBalance', async () => {
    const client = new X402Client(baseConfig);
    const expectedData = {
      wallet: '0x123',
      balance: 100,
      totalPurchased: 200,
      totalConsumed: 100,
      tier: 'standard',
    };
    const getBalanceSpy = vi.spyOn(client.credits, 'getBalance').mockResolvedValue(expectedData);

    const result = await client.getBalance();

    expect(getBalanceSpy).toHaveBeenCalled();
    expect(result).toEqual(expectedData);
  });

  it('health() delegates to discovery.health', async () => {
    const client = new X402Client(baseConfig);
    const expectedData = { status: 'ok', uptime: 12345 };
    const healthSpy = vi.spyOn(client.discovery, 'health').mockResolvedValue(expectedData);

    const result = await client.health();

    expect(healthSpy).toHaveBeenCalled();
    expect(result).toEqual(expectedData);
  });
});
