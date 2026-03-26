import { HttpClient } from '../../src/utils/http.js';
import { NetworkError } from '../../src/errors/index.js';

const mockFetch = vi.fn();

describe('HttpClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('strips trailing slashes from base URL', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      const client = new HttpClient('https://api.example.com/', 5000, mockFetch);
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.any(Object),
      );
    });

    it('strips multiple trailing slashes from base URL', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      });
      const client = new HttpClient('https://api.example.com///', 5000, mockFetch);
      await client.get('/test');
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test', expect.any(Object));
    });
  });

  describe('setToken / getToken', () => {
    it('attaches Authorization Bearer header when token is set', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);
      client.setToken('my-jwt-token');
      await client.get('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-jwt-token',
          }),
        }),
      );
    });

    it('does not attach Authorization when token is unset', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);
      client.setToken(undefined);
      await client.get('/test');

      const call = mockFetch.mock.calls[0][1];
      expect(call.headers).not.toHaveProperty('Authorization');
    });

    it('getToken returns set token', () => {
      const client = new HttpClient('https://api.example.com');
      expect(client.getToken()).toBeUndefined();
      client.setToken('token-123');
      expect(client.getToken()).toBe('token-123');
      client.setToken(undefined);
      expect(client.getToken()).toBeUndefined();
    });
  });

  describe('request', () => {
    it('sends JSON content-type by default', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ ok: true }),
      });

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);
      await client.request('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('handles JSON responses', async () => {
      const jsonData = { id: 1, name: 'test' };
      mockFetch.mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => jsonData,
      });

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);
      const res = await client.request<{ id: number; name: string }>('/test');

      expect(res.data).toEqual(jsonData);
      expect(res.status).toBe(200);
    });

    it('handles text responses', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'plain text response',
      });

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);
      const res = await client.request<string>('/test');

      expect(res.data).toBe('plain text response');
      expect(res.status).toBe(200);
    });

    it('throws NetworkError on timeout (AbortError)', async () => {
      mockFetch.mockImplementation(() =>
        Promise.reject(new DOMException('aborted', 'AbortError')),
      );

      const client = new HttpClient('https://api.example.com', 100, mockFetch);

      await expect(client.request('/test')).rejects.toThrow(NetworkError);
      await expect(client.request('/test')).rejects.toThrow(/timed out after 100ms/);
    });

    it('throws NetworkError on fetch failure', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);

      await expect(client.request('/test')).rejects.toThrow(NetworkError);
      await expect(client.request('/test')).rejects.toThrow(/Connection refused/);
    });

    it('throws NetworkError for non-Error rejections', async () => {
      mockFetch.mockRejectedValue('string error');

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);

      await expect(client.request('/test')).rejects.toThrow(NetworkError);
      await expect(client.request('/test')).rejects.toThrow(/string error/);
    });
  });

  describe('buildQueryString', () => {
    it('builds correct query strings', () => {
      const client = new HttpClient('https://api.example.com');
      expect(client.buildQueryString({ a: '1', b: 2, c: true })).toBe(
        '?a=1&b=2&c=true',
      );
    });

    it('returns empty string for empty params', () => {
      const client = new HttpClient('https://api.example.com');
      expect(client.buildQueryString({})).toBe('');
    });

    it('filters out undefined values', () => {
      const client = new HttpClient('https://api.example.com');
      expect(client.buildQueryString({ a: '1', b: undefined, c: 3 })).toBe(
        '?a=1&c=3',
      );
    });

    it('encodes special characters', () => {
      const client = new HttpClient('https://api.example.com');
      expect(client.buildQueryString({ q: 'hello world', x: 'a&b' })).toBe(
        '?q=hello%20world&x=a%26b',
      );
    });
  });

  describe('GET convenience method', () => {
    it('works and delegates to request with GET', async () => {
      mockFetch.mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: 'get-result' }),
      });

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);
      const res = await client.get<{ data: string }>('/items');

      expect(res.data).toEqual({ data: 'get-result' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('POST convenience method', () => {
    it('works and delegates to request with POST and body', async () => {
      mockFetch.mockResolvedValue({
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 42 }),
      });

      const client = new HttpClient('https://api.example.com', 5000, mockFetch);
      const body = { name: 'test', value: 100 };
      const res = await client.post<{ id: number }>('/items', body);

      expect(res.data).toEqual({ id: 42 });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });
  });
});
