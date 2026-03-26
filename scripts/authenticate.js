#!/usr/bin/env node

/**
 * Authenticate with x402 Gateway using SIWE.
 *
 * Usage:
 *   EVM_PRIVATE_KEY=0x... X402_GATEWAY_URL=http://localhost:4021 node scripts/authenticate.js
 *
 * Outputs JSON: { wallet, token, tier, balance, expiresIn }
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

  const authResult = await client.authenticate();
  const balance = await client.getBalance();

  console.log(JSON.stringify({
    success: true,
    wallet: authResult.wallet,
    tier: authResult.tier,
    balance: balance.balance,
    totalPurchased: balance.totalPurchased,
    totalConsumed: balance.totalConsumed,
    expiresIn: authResult.expiresIn,
  }, null, 2));
} catch (err) {
  console.error(JSON.stringify({
    error: err.name || 'UnknownError',
    message: err.message,
    code: err.code,
  }));
  process.exit(1);
}
