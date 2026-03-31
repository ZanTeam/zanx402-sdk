#!/usr/bin/env node

/**
 * Purchase credits from x402 Gateway.
 *
 * Usage:
 *   EVM_PRIVATE_KEY=0x... X402_GATEWAY_URL=http://localhost:4021 node scripts/purchase-credits.js <bundle>
 *
 * Arguments:
 *   bundle  — 当前建议使用 "default" (default: "default")
 *
 * The SDK will:
 *   1. Authenticate via SIWE
 *   2. POST /credits/purchase/{bundle}
 *   3. If 402 + PAYMENT-REQUIRED, return payment options for manual completion
 *   4. If 200, return purchase receipt
 *
 * Outputs JSON with purchase result or payment options.
 */

import { X402Client } from '../dist/esm/index.js';

const GATEWAY_URL = process.env.X402_GATEWAY_URL || 'http://localhost:4021';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const BUNDLE = process.argv[2] || 'default';

if (!PRIVATE_KEY) {
  console.error(JSON.stringify({ error: 'EVM_PRIVATE_KEY environment variable is required' }));
  process.exit(1);
}

try {
  const client = new X402Client({
    gatewayUrl: GATEWAY_URL,
    privateKey: PRIVATE_KEY,
    chainType: 'EVM',
    autoPayment: false,
  });

  const result = await client.purchaseCredits(BUNDLE);

  if (result._paymentRequired) {
    console.log(JSON.stringify({
      success: false,
      status: 'payment_required',
      message: 'x402 on-chain USDC payment required. Use the payment options below.',
      bundle: BUNDLE,
      paymentOptions: result._paymentRequired,
      instructions: {
        nextSteps: [
          '1. Check estimate-cost.js for pricing',
          '2. Complete payment with your wallet',
          '3. Retry purchase after confirmation'
        ]
      }
    }, null, 2));
    process.exit(0);
  }

  console.log(JSON.stringify({
    success: true,
    bundle: result.bundle,
    creditsPurchased: result.creditsPurchased,
    balance: result.balance,
    tier: result.tier,
    paymentMode: result.paymentMode,
    txHash: result.txHash || null,
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
