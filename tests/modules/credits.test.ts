import { CreditsModule } from '../../src/modules/credits.js';
import { HttpClient } from '../../src/utils/http.js';
import { ENDPOINTS, HEADERS } from '../../src/constants.js';
import type { AuthModule } from '../../src/modules/auth.js';

describe('CreditsModule', () => {
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

  it('getBalance() returns balance data', async () => {
    const expectedData = { wallet: '0x123', balance: 100, totalPurchased: 200, totalConsumed: 100, tier: 'standard' };
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.get.mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const credits = new CreditsModule(mockHttp, mockAuth);
    const result = await credits.getBalance();

    expect(mockHttp.get).toHaveBeenCalledWith(ENDPOINTS.BALANCE);
    expect(result).toEqual(expectedData);
  });

  it('getBalance() calls ensureAuthenticated', async () => {
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.get.mockResolvedValue({
      data: { wallet: '0x', balance: 0, totalPurchased: 0, totalConsumed: 0, tier: 'trial' },
      status: 200,
      headers: new Headers(),
    });

    const credits = new CreditsModule(mockHttp, mockAuth);
    await credits.getBalance();

    expect(mockAuth.ensureAuthenticated).toHaveBeenCalled();
  });

  it('purchaseCredits() with paymentSignature calls completePurchase', async () => {
    const expectedData = {
      success: true,
      bundle: 'default',
      creditsPurchased: 100,
      balance: 100,
      tier: 'standard',
      paymentMode: 'usdc',
      txHash: '0xabc',
      paymentNetwork: 'base',
    };
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.post.mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const credits = new CreditsModule(mockHttp, mockAuth);
    const result = await credits.purchaseCredits('default', 'payment-sig-123');

    const expectedPath = `${ENDPOINTS.PURCHASE}/default`;
    expect(mockHttp.post).toHaveBeenCalledWith(
      expectedPath,
      undefined,
      expect.objectContaining({
        headers: { [HEADERS.PAYMENT_SIGNATURE]: 'payment-sig-123' },
      }),
    );
    expect(result).toEqual(expectedData);
  });

  it('purchaseCredits() without signature initiates 402 flow', async () => {
    const paymentPayload = {
      accepts: [
        {
          network: 'base',
          chainId: 8453,
          tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          recipient: '0x123',
          amount: '10000000',
        },
      ],
    };
    const headers = new Headers();
    headers.set(
      HEADERS.PAYMENT_REQUIRED,
      Buffer.from(JSON.stringify(paymentPayload), 'utf-8').toString('base64'),
    );

    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.post.mockResolvedValue({
      data: { message: 'Payment required' },
      status: 402,
      headers,
    });

    const credits = new CreditsModule(mockHttp, mockAuth);
    const result = await credits.purchaseCredits('default');

    expect(mockHttp.post).toHaveBeenCalledWith(`${ENDPOINTS.PURCHASE}/default`);
    expect(result).toHaveProperty('_paymentRequired');
    expect((result as { _paymentRequired: { accepts: unknown[] } })._paymentRequired.accepts).toHaveLength(1);
  });

  it('getUsage() builds correct query string', async () => {
    const expectedData = { records: [], total: 0 };
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.buildQueryString.mockReturnValue('?limit=10&offset=0&provider=p1');
    mockHttp.get.mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const credits = new CreditsModule(mockHttp, mockAuth);
    await credits.getUsage({ limit: 10, offset: 0, provider: 'p1' });

    expect(mockHttp.buildQueryString).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
      provider: 'p1',
    });
    expect(mockHttp.get).toHaveBeenCalledWith(`${ENDPOINTS.USAGE}?limit=10&offset=0&provider=p1`);
  });

  it('getPaymentStatus() sends correct path', async () => {
    const expectedData = {
      status: 'settled',
      bundle: 'default',
      creditsPurchased: 100,
      txHash: '0xabc',
      paymentNetwork: 'base',
      settledAt: '2024-01-01T00:00:00Z',
    };
    const mockHttp = createMockHttp() as unknown as HttpClient;
    const mockAuth = createMockAuth() as unknown as AuthModule;
    mockHttp.get.mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const credits = new CreditsModule(mockHttp, mockAuth);
    const result = await credits.getPaymentStatus('idempotency-key-123');

    const expectedPath = `${ENDPOINTS.PAYMENT_STATUS}/idempotency-key-123`;
    expect(mockHttp.get).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual(expectedData);
  });
});
