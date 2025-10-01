export type ProviderErrorClassification =
  | 'TEMPORARY'
  | 'PERMANENT'
  | 'AUTH'
  | 'CONFIG'
  | 'RATE_LIMIT';

export interface ProviderErrorOptions {
  retryAfterMs?: number;
  cause?: unknown;
}

export class ProviderError extends Error {
  public readonly classification: ProviderErrorClassification;
  public readonly retryAfterMs?: number;

  constructor(message: string, classification: ProviderErrorClassification, options: ProviderErrorOptions = {}) {
    super(message);
    this.classification = classification;
    this.retryAfterMs = options.retryAfterMs;
    if (options.cause !== undefined) {
      // Preserve original cause when available for diagnostics.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function isRetryable(classification: ProviderErrorClassification): boolean {
  return classification === 'TEMPORARY' || classification === 'RATE_LIMIT';
}
