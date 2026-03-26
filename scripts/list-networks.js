#!/usr/bin/env node

/**
 * List supported blockchain networks and credit bundles from x402 Gateway.
 *
 * Usage:
 *   X402_GATEWAY_URL=http://localhost:4021 node scripts/list-networks.js
 *
 * No authentication required — these are public discovery endpoints.
 */

import { X402Client } from '../dist/esm/index.js';

const GATEWAY_URL = process.env.X402_GATEWAY_URL || 'http://localhost:4021';

try {
  const client = new X402Client({
    gatewayUrl: GATEWAY_URL,
    chainType: 'EVM',
  });

  const [networks, bundles] = await Promise.all([
    client.listNetworks(),
    client.listBundles(),
  ]);

  console.log(JSON.stringify({
    success: true,
    networks: networks.networks,
    bundles: bundles.bundles,
  }, null, 2));
} catch (err) {
  console.error(JSON.stringify({
    error: err.name || 'UnknownError',
    message: err.message,
  }));
  process.exit(1);
}
