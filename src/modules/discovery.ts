import type { HealthResponse, ProvidersResponse, NetworksResponse, BundleListResponse, X402Capability } from '../types/discovery.js';
import { HttpClient } from '../utils/http.js';
import { ENDPOINTS } from '../constants.js';
import { X402Error } from '../errors/index.js';

/**
 * Discovery module — public endpoints that don't require authentication.
 * Provides service health, provider listings, network listings, bundle info, and x402 capability.
 */
export class DiscoveryModule {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /** Health check */
  async health(): Promise<HealthResponse> {
    const { data } = await this.http.get<HealthResponse>(ENDPOINTS.HEALTH);
    return data;
  }

  /** List all registered providers */
  async listProviders(): Promise<ProvidersResponse> {
    const { data } = await this.http.get<ProvidersResponse>(ENDPOINTS.PROVIDERS);
    return data;
  }

  /** List all supported blockchain networks */
  async listNetworks(): Promise<NetworksResponse> {
    const { data } = await this.http.get<NetworksResponse>(ENDPOINTS.NETWORKS);
    return data;
  }

  /** List available credit bundles */
  async listBundles(): Promise<BundleListResponse> {
    const { data } = await this.http.get<BundleListResponse>(ENDPOINTS.BUNDLES);
    return data;
  }

  /** Get x402 capability declaration */
  async getX402Capability(): Promise<X402Capability> {
    const { data } = await this.http.get<X402Capability>(ENDPOINTS.WELL_KNOWN);
    return data;
  }

  /** Get llms.txt (AI agent discovery) */
  async getLlmsTxt(): Promise<string> {
    const { data } = await this.http.get<string>(ENDPOINTS.LLMS_TXT);
    return data;
  }
}
