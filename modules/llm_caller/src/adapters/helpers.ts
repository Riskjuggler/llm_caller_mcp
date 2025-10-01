import { ProviderError, type ProviderErrorClassification } from '../providerErrors.js';

export function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

export function mapStatusToClassification(status: number): ProviderErrorClassification {
  if (status === 401 || status === 403) {
    return 'AUTH';
  }
  if (status === 429) {
    return 'RATE_LIMIT';
  }
  if (status >= 500) {
    return 'TEMPORARY';
  }
  if (status >= 400) {
    return 'PERMANENT';
  }
  // Default retryable classification for unexpected statuses.
  return 'TEMPORARY';
}

export function createHttpError(
  providerName: string,
  status: number,
  body: unknown
): ProviderError {
  const classification = mapStatusToClassification(status);
  const detail = extractErrorMessage(body) ?? `HTTP ${status}`;
  return new ProviderError(`${providerName} request failed: ${detail}`, classification, { cause: body });
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (typeof body === 'object') {
    const maybeRecord = body as Record<string, unknown>;
    if (typeof maybeRecord.error === 'string') {
      return maybeRecord.error;
    }
    if (maybeRecord.error && typeof maybeRecord.error === 'object') {
      const errorObject = maybeRecord.error as Record<string, unknown>;
      if (typeof errorObject.message === 'string') {
        return errorObject.message;
      }
    }
    if (typeof maybeRecord.message === 'string') {
      return maybeRecord.message;
    }
  }
  return undefined;
}
