#!/usr/bin/env node

/**
 * Get credit balance from x402 Gateway.
 *
 * Usage:
 *   EVM_PRIVATE_KEY=0x... X402_GATEWAY_URL=http://localhost:4021 node scripts/get-balance.js
 *
 * Outputs JSON: { wallet, balance, totalPurchased, totalConsumed, tier }
 */

import { X402Client } from '../dist/esm/index.js';

const GATEWAY_URL = process.env.X402_GATEWAY_URL || 'http://localhost:4021';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;

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

  const balance = await client.getBalance();

  console.log(JSON.stringify({
    success: true,
    wallet: balance.wallet,
    balance: balance.balance,
    totalPurchased: balance.totalPurchased,
    totalConsumed: balance.totalConsumed,
    tier: balance.tier,
  }, null, 2));
} catch (err) {
  console.error(JSON.stringify({
    error: err.name || 'UnknownError',
    message: err.message,
    code: err.code,
  }));
  process.exit(1);
}
