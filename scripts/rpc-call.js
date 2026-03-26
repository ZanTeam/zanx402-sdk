#!/usr/bin/env node

/**
 * Call a blockchain RPC method via x402 Gateway.
 *
 * Usage:
 *   EVM_PRIVATE_KEY=0x... X402_GATEWAY_URL=http://localhost:4021 \
 *     node scripts/rpc-call.js <ecosystem> <network> <method> [params_json]
 *
 * Arguments:
 *   ecosystem   — "eth", "base", "solana", etc.
 *   network     — "mainnet", "sepolia", "devnet", etc.
 *   method      — RPC method, e.g. "eth_blockNumber", "eth_getBalance", "getSlot"
 *   params_json — JSON array of params (default: "[]")
 *
 * Examples:
 *   node scripts/rpc-call.js eth mainnet eth_blockNumber
 *   node scripts/rpc-call.js eth mainnet eth_getBalance '["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","latest"]'
 *   node scripts/rpc-call.js solana mainnet getSlot
 *
 * If autoPayment is enabled and credits are insufficient, the SDK will
 * automatically purchase the default bundle and retry.
 */

import { X402Client } from '../dist/esm/index.js';

const GATEWAY_URL = process.env.X402_GATEWAY_URL || 'http://localhost:4021';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const AUTO_PAYMENT = process.env.X402_AUTO_PAYMENT !== 'false';
const DEFAULT_BUNDLE = process.env.X402_DEFAULT_BUNDLE || 'default';

const [ecosystem, network, method, paramsJson] = process.argv.slice(2);

if (!PRIVATE_KEY) {
  console.error(JSON.stringify({ error: 'EVM_PRIVATE_KEY environment variable is required' }));
  process.exit(1);
}

if (!ecosystem || !network || !method) {
  console.error(JSON.stringify({
    error: 'Missing arguments',
    usage: 'node scripts/rpc-call.js <ecosystem> <network> <method> [params_json]',
    example: 'node scripts/rpc-call.js eth mainnet eth_blockNumber',
  }));
  process.exit(1);
}

let params = [];
if (paramsJson) {
  try {
    params = JSON.parse(paramsJson);
  } catch {
    console.error(JSON.stringify({ error: `Invalid params JSON: ${paramsJson}` }));
    process.exit(1);
  }
}

try {
  const client = new X402Client({
    gatewayUrl: GATEWAY_URL,
    privateKey: PRIVATE_KEY,
    chainType: 'EVM',
    autoPayment: AUTO_PAYMENT,
    defaultBundle: DEFAULT_BUNDLE,
  });

  const result = await client.call(ecosystem, network, method, params);

  console.log(JSON.stringify({
    success: true,
    ecosystem,
    network,
    method,
    result: result.result,
    error: result.error || null,
    id: result.id,
  }, null, 2));
} catch (err) {
  console.error(JSON.stringify({
    error: err.name || 'UnknownError',
    message: err.message,
    code: err.code,
    required: err.required,
    balance: err.balance,
  }));
  process.exit(1);
}
