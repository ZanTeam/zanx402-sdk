import { buildSiweMessage, extractDomain, generateNonce } from '../../src/utils/siwe.js';

describe('SIWE utilities', () => {
  describe('buildSiweMessage', () => {
    it('includes domain, address, URI, nonce, chainId', () => {
      const params = {
        domain: 'gateway.example.com',
        address: '0x1234567890123456789012345678901234567890',
        uri: 'https://gateway.example.com/login',
        nonce: 'abc123nonce',
        chainId: 1,
      };

      const message = buildSiweMessage(params);

      expect(message).toContain('gateway.example.com wants you to sign in with your Ethereum account:');
      expect(message).toContain(params.address);
      expect(message).toContain(`URI: ${params.uri}`);
      expect(message).toContain(`Nonce: ${params.nonce}`);
      expect(message).toContain(`Chain ID: ${params.chainId}`);
    });

    it('includes optional expirationTime when provided', () => {
      const params = {
        domain: 'gateway.example.com',
        address: '0x1234567890123456789012345678901234567890',
        uri: 'https://gateway.example.com/login',
        nonce: 'abc123nonce',
        expirationTime: '2025-12-31T23:59:59.000Z',
      };

      const message = buildSiweMessage(params);

      expect(message).toContain(`Expiration Time: ${params.expirationTime}`);
    });

    it('does not include expirationTime when not provided', () => {
      const params = {
        domain: 'gateway.example.com',
        address: '0x1234567890123456789012345678901234567890',
        uri: 'https://gateway.example.com/login',
        nonce: 'abc123nonce',
      };

      const message = buildSiweMessage(params);

      expect(message).not.toContain('Expiration Time:');
    });

    it('uses default chainId 1 when not provided', () => {
      const params = {
        domain: 'gateway.example.com',
        address: '0x1234567890123456789012345678901234567890',
        uri: 'https://gateway.example.com/login',
        nonce: 'abc123nonce',
      };

      const message = buildSiweMessage(params);

      expect(message).toContain('Chain ID: 1');
    });

    it('uses custom chainId when provided', () => {
      const params = {
        domain: 'gateway.example.com',
        address: '0x1234567890123456789012345678901234567890',
        uri: 'https://gateway.example.com/login',
        nonce: 'abc123nonce',
        chainId: 137,
      };

      const message = buildSiweMessage(params);

      expect(message).toContain('Chain ID: 137');
    });
  });

  describe('extractDomain', () => {
    it('extracts host from full URL', () => {
      expect(extractDomain('https://gateway.example.com/path')).toBe('gateway.example.com');
      expect(extractDomain('https://api.zan.top:443/v1')).toBe('api.zan.top');
      expect(extractDomain('http://localhost:3000')).toBe('localhost:3000');
    });

    it('returns input for non-URL strings', () => {
      expect(extractDomain('not-a-url')).toBe('not-a-url');
      expect(extractDomain('')).toBe('');
      expect(extractDomain('invalid url with spaces')).toBe('invalid url with spaces');
    });
  });

  describe('generateNonce', () => {
    it('generates 16-char alphanumeric string', () => {
      const nonce = generateNonce();
      expect(nonce).toHaveLength(16);
      expect(nonce).toMatch(/^[A-Za-z0-9]{16}$/);
    });

    it('generates unique values', () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 100; i++) {
        nonces.add(generateNonce());
      }
      expect(nonces.size).toBe(100);
    });
  });
});
