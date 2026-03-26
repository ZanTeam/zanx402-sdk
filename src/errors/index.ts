export class X402Error extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: unknown;

  constructor(message: string, code: string, statusCode?: number, details?: unknown) {
    super(message);
    this.name = 'X402Error';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class AuthenticationError extends X402Error {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

export class InsufficientCreditsError extends X402Error {
  public readonly required: number;
  public readonly balance: number;
  public readonly purchaseUrl?: string;

  constructor(required: number, balance: number, purchaseUrl?: string) {
    super(
      `Insufficient credits: need ${required}, have ${balance}`,
      'INSUFFICIENT_CREDITS',
      402,
    );
    this.name = 'InsufficientCreditsError';
    this.required = required;
    this.balance = balance;
    this.purchaseUrl = purchaseUrl;
  }
}

export class InsufficientFundsError extends X402Error {
  constructor(message = 'On-chain USDC balance too low for payment') {
    super(message, 'INSUFFICIENT_FUNDS', 402);
    this.name = 'InsufficientFundsError';
  }
}

export class PaymentRejectedError extends X402Error {
  public readonly txHash?: string;

  constructor(message: string, txHash?: string) {
    super(message, 'PAYMENT_REJECTED', 402);
    this.name = 'PaymentRejectedError';
    this.txHash = txHash;
  }
}

export class ProviderNotFoundError extends X402Error {
  public readonly path: string;

  constructor(path: string) {
    super(`No matching provider for path: ${path}`, 'PROVIDER_NOT_FOUND', 404);
    this.name = 'ProviderNotFoundError';
    this.path = path;
  }
}

export class MethodNotAllowedError extends X402Error {
  constructor(message: string) {
    super(message, 'METHOD_NOT_ALLOWED', 403);
    this.name = 'MethodNotAllowedError';
  }
}

export class UpstreamError extends X402Error {
  public readonly creditRefunded: boolean;

  constructor(message: string, statusCode: number, creditRefunded = false) {
    super(message, 'UPSTREAM_ERROR', statusCode);
    this.name = 'UpstreamError';
    this.creditRefunded = creditRefunded;
  }
}

export class SessionExpiredError extends X402Error {
  constructor() {
    super('JWT session expired, re-authentication required', 'SESSION_EXPIRED', 401);
    this.name = 'SessionExpiredError';
  }
}

export class NetworkError extends X402Error {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', undefined, details);
    this.name = 'NetworkError';
  }
}
