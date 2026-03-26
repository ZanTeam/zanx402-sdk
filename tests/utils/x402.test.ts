import {
  parsePaymentRequired,
  encodePaymentSignature,
  buildPaymentSignaturePayload,
} from '../../src/utils/x402.js';
import { HEADERS } from '../../src/constants.js';

describe('x402 utilities', () => {
  describe('parsePaymentRequired', () => {
    it('decodes valid base64 header', () => {
      const payload = { accepts: [{ network: 'base-sepolia', amount: '1000000' }] };
      const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
      const headers = new Headers({ [HEADERS.PAYMENT_REQUIRED]: encoded });

      const result = parsePaymentRequired(headers);

      expect(result).toEqual(payload);
    });

    it('returns null for missing header', () => {
      const headers = new Headers();

      const result = parsePaymentRequired(headers);

      expect(result).toBeNull();
    });

    it('returns null for invalid base64', () => {
      const headers = new Headers({ [HEADERS.PAYMENT_REQUIRED]: 'not-valid-base64!!!' });

      const result = parsePaymentRequired(headers);

      expect(result).toBeNull();
    });

    it('returns null for invalid JSON in base64', () => {
      const invalidJson = Buffer.from('{ invalid json }', 'utf-8').toString('base64');
      const headers = new Headers({ [HEADERS.PAYMENT_REQUIRED]: invalidJson });

      const result = parsePaymentRequired(headers);

      expect(result).toBeNull();
    });
  });

  describe('encodePaymentSignature', () => {
    it('encodes to valid base64', () => {
      const payload = { x402Version: 2, scheme: 'exact', network: 'base-sepolia' };
      const encoded = encodePaymentSignature(payload);

      expect(encoded).toBe(Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64'));
    });

    it('produces decodable output', () => {
      const payload = { foo: 'bar', nested: { a: 1 } };
      const encoded = encodePaymentSignature(payload);
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));

      expect(decoded).toEqual(payload);
    });
  });

  describe('buildPaymentSignaturePayload', () => {
    it('includes correct structure with x402Version, scheme, network, payload', () => {
      const params = {
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '1000000',
        validAfter: 0,
        validBefore: 9999999999,
        nonce: 'abc123',
        signature: '0xdeadbeef',
        network: 'base-sepolia',
      };

      const result = buildPaymentSignaturePayload(params);

      expect(result).toEqual({
        x402Version: 2,
        scheme: 'exact',
        network: 'base-sepolia',
        payload: {
          signature: '0xdeadbeef',
          authorization: {
            from: params.from,
            to: params.to,
            value: params.value,
            validAfter: params.validAfter,
            validBefore: params.validBefore,
            nonce: params.nonce,
          },
        },
      });
    });

    it('includes chainId when provided', () => {
      const params = {
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '1000000',
        validAfter: 0,
        validBefore: 9999999999,
        nonce: 'abc123',
        signature: '0xdeadbeef',
        network: 'base-sepolia',
        chainId: 84532,
      };

      const result = buildPaymentSignaturePayload(params);

      expect(result.network).toBe('base-sepolia');
      expect(result.payload).toBeDefined();
      expect(result.payload.authorization).toBeDefined();
    });
  });
});
