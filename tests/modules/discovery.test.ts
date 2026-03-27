import { DiscoveryModule } from '../../src/modules/discovery.js';
import { HttpClient } from '../../src/utils/http.js';
import { ENDPOINTS } from '../../src/constants.js';

describe('DiscoveryModule', () => {
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

  it('health() returns health status', async () => {
    const expectedData = { status: 'ok', uptime: 12345 };
    const mockHttp = createMockHttp();
    vi.mocked(mockHttp.get).mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const discovery = new DiscoveryModule(mockHttp as unknown as HttpClient);
    const result = await discovery.health();

    expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(ENDPOINTS.HEALTH);
    expect(result).toEqual(expectedData);
  });

  it('listProviders() returns providers array', async () => {
    const expectedData = { providers: [{ id: 'p1', name: 'Provider 1', type: 'rpc', description: '', routes: [] }] };
    const mockHttp = createMockHttp();
    vi.mocked(mockHttp.get).mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const discovery = new DiscoveryModule(mockHttp as unknown as HttpClient);
    const result = await discovery.listProviders();

    expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(ENDPOINTS.PROVIDERS);
    expect(result).toEqual(expectedData);
  });

  it('listNetworks() returns networks array', async () => {
    const expectedData = { networks: [{ ecosystem: 'eth', network: 'mainnet', providerId: 'p1' }] };
    const mockHttp = createMockHttp();
    vi.mocked(mockHttp.get).mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const discovery = new DiscoveryModule(mockHttp as unknown as HttpClient);
    const result = await discovery.listNetworks();

    expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(ENDPOINTS.NETWORKS);
    expect(result).toEqual(expectedData);
  });

  it('listBundles() returns bundles array', async () => {
    const expectedData = { bundles: [{ name: 'default', credits: 100, price: 10, description: 'Default bundle' }] };
    const mockHttp = createMockHttp();
    vi.mocked(mockHttp.get).mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const discovery = new DiscoveryModule(mockHttp as unknown as HttpClient);
    const result = await discovery.listBundles();

    expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(ENDPOINTS.BUNDLES);
    expect(result).toEqual(expectedData);
  });

  it('getX402Capability() returns capability object', async () => {
    const expectedData = {
      name: 'x402-gateway',
      version: '1.0',
      description: 'x402 Gateway',
      endpoints: [],
      auth: {},
      rpc: {},
    };
    const mockHttp = createMockHttp();
    vi.mocked(mockHttp.get).mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const discovery = new DiscoveryModule(mockHttp as unknown as HttpClient);
    const result = await discovery.getX402Capability();

    expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(ENDPOINTS.WELL_KNOWN);
    expect(result).toEqual(expectedData);
  });

  it('getLlmsTxt() returns text string', async () => {
    const expectedData = '# LLMs\nProvider list for AI agents...';
    const mockHttp = createMockHttp();
    vi.mocked(mockHttp.get).mockResolvedValue({ data: expectedData, status: 200, headers: new Headers() });

    const discovery = new DiscoveryModule(mockHttp as unknown as HttpClient);
    const result = await discovery.getLlmsTxt();

    expect(vi.mocked(mockHttp.get)).toHaveBeenCalledWith(ENDPOINTS.LLMS_TXT);
    expect(result).toBe(expectedData);
  });
});
