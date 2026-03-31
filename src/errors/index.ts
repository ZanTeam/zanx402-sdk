export class X402Error extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: unknown;
  public readonly traceId?: string;

  constructor(message: string, code: string, statusCode?: number, details?: unknown, traceId?: string) {
    super(traceId ? `${message} [traceId=${traceId}]` : message);
    this.name = 'X402Error';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.traceId = traceId;
  }
}

export class AuthenticationError extends X402Error {
  constructor(message: string, details?: unknown, traceId?: string) {
    super(message, 'AUTHENTICATION_ERROR', 401, details, traceId);
    this.name = 'AuthenticationError';
  }
}

export class InsufficientCreditsError extends X402Error {
  public readonly required: number;
  public readonly balance: number;
  public readonly purchaseUrl?: string;

  constructor(required: number, balance: number, purchaseUrl?: string, traceId?: string) {
    super(
      `Insufficient credits: need ${required}, have ${balance}`,
      'INSUFFICIENT_CREDITS',
      402,
      undefined,
      traceId,
    );
    this.name = 'InsufficientCreditsError';
    this.required = required;
    this.balance = balance;
    this.purchaseUrl = purchaseUrl;
  }
}

export class InsufficientFundsError extends X402Error {
  constructor(message = 'On-chain USDC balance too low for payment', traceId?: string) {
    super(message, 'INSUFFICIENT_FUNDS', 402, undefined, traceId);
    this.name = 'InsufficientFundsError';
  }
}

export class PaymentRejectedError extends X402Error {
  public readonly txHash?: string;

  constructor(message: string, txHash?: string, traceId?: string, details?: unknown) {
    super(message, 'PAYMENT_REJECTED', 402, details, traceId);
    this.name = 'PaymentRejectedError';
    this.txHash = txHash;
  }
}

export class ProviderNotFoundError extends X402Error {
  public readonly path: string;

  constructor(path: string, traceId?: string) {
    super(`No matching provider for path: ${path}`, 'PROVIDER_NOT_FOUND', 404, undefined, traceId);
    this.name = 'ProviderNotFoundError';
    this.path = path;
  }
}

export class MethodNotAllowedError extends X402Error {
  constructor(message: string, traceId?: string) {
    super(message, 'METHOD_NOT_ALLOWED', 403, undefined, traceId);
    this.name = 'MethodNotAllowedError';
  }
}

export class UpstreamError extends X402Error {
  public readonly creditRefunded: boolean;

  constructor(message: string, statusCode: number, creditRefunded = false, traceId?: string) {
    super(message, 'UPSTREAM_ERROR', statusCode, undefined, traceId);
    this.name = 'UpstreamError';
    this.creditRefunded = creditRefunded;
  }
}

export class SessionExpiredError extends X402Error {
  constructor(traceId?: string) {
    super('JWT session expired, re-authentication required', 'SESSION_EXPIRED', 401, undefined, traceId);
    this.name = 'SessionExpiredError';
  }
}

export class NetworkError extends X402Error {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', undefined, details);
    this.name = 'NetworkError';
  }
}
