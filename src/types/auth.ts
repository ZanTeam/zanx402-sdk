import type { ChainType, Tier } from './common.js';

export interface AuthRequest {
  chainType: ChainType;
  message: string;
  signature: string;
}

export interface AuthSuccess {
  token: string;
  expiresIn: number;
  wallet: string;
  chainType: ChainType;
  tier: Tier;
  balance: number;
}

export interface AuthError {
  error: string;
  message: string;
}

export interface AuthSession {
  token: string;
  expiresAt: number;
  wallet: string;
  chainType: ChainType;
  tier: Tier;
}
