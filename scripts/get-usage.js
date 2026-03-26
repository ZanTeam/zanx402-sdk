#!/usr/bin/env node

/**
 * Get RPC usage history from x402 Gateway.
 *
 * Usage:
 *   EVM_PRIVATE_KEY=0x... X402_GATEWAY_URL=http://localhost:4021 node scripts/get-usage.js [limit]
 *
 * Arguments:
 *   limit — number of records to return (default: 20)
 */

import { X402Client } from '../dist/esm/index.js';

const GATEWAY_URL = process.env.X402_GATEWAY_URL || 'http://localhost:4021';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const LIMIT = parseInt(process.argv[2] || '20', 10);

if (!PRIVATE_KEY) {
  console.error(JSON.stringify({ error: 'EVM_PRIVATE_KEY environment variable is required' }));
  process.exit(1);
}

try {
  const client = new X402Client({
    gatewayUrl: GATEWAY_URL,
    privateKey: PRIVATE_KEY,
    chainType: 'EVM',
  });

  const usage = await client.getUsage({ limit: LIMIT });

  console.log(JSON.stringify({
    success: true,
    total: usage.total,
    records: usage.records,
  }, null, 2));
} catch (err) {
  console.error(JSON.stringify({
    error: err.name || 'UnknownError',
    message: err.message,
    code: err.code,
  }));
  process.exit(1);
}
