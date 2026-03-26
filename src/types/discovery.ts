export interface HealthResponse {
  status: string;
  uptime: number;
}

export interface ProviderRoute {
  path: string;
  method: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  type: string;
  description: string;
  routes: ProviderRoute[];
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
}

export interface NetworkInfo {
  ecosystem: string;
  network: string;
  providerId: string;
}

export interface NetworksResponse {
  networks: NetworkInfo[];
}

export interface BundleListResponse {
  bundles: BundleDetailInfo[];
}

export interface BundleDetailInfo {
  name: string;
  credits: number;
  price: number;
  description: string;
}

export interface X402Capability {
  name: string;
  version: string;
  description: string;
  endpoints: X402Endpoint[];
  auth: Record<string, unknown>;
  rpc: Record<string, unknown>;
}

export interface X402Endpoint {
  path: string;
  method: string;
  description?: string;
  price?: number;
}
