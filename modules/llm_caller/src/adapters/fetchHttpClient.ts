import type { HttpClient, HttpRequestOptions, HttpResponse } from './httpClient.js';

export class FetchHttpClient implements HttpClient {
  async post<T = unknown>(url: string, options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs);
    }

    try {
      const headers: Record<string, string> = { ...(options.headers ?? {}) };
      const body = serializeBody(options.body, headers);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });
      const rawBody = await response.text();
      let parsedBody: unknown;

      try {
        parsedBody = rawBody.length ? JSON.parse(rawBody) : undefined;
      } catch (error) {
        parsedBody = rawBody;
      }

      const responseHeaders = Object.fromEntries(response.headers.entries());

      return {
        status: response.status,
        body: parsedBody as T,
        headers: responseHeaders
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async get<T = unknown>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs);
    }

    try {
      const headers: Record<string, string> = { ...(options.headers ?? {}) };
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      const rawBody = await response.text();
      let parsedBody: unknown;

      try {
        parsedBody = rawBody.length ? JSON.parse(rawBody) : undefined;
      } catch (error) {
        parsedBody = rawBody;
      }

      const responseHeaders = Object.fromEntries(response.headers.entries());

      return {
        status: response.status,
        body: parsedBody as T,
        headers: responseHeaders
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async *postStream(url: string, options: HttpRequestOptions): AsyncIterable<string> {
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs);
    }

    try {
      const headers: Record<string, string> = { ...(options.headers ?? {}) };
      const body = serializeBody(options.body, headers);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });

      if (response.status < 200 || response.status >= 300) {
        const errorBody = await response.text();
        throw new Error(`Streaming request failed with status ${response.status}: ${errorBody}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const remainder = buffer.trim();
          if (remainder.length > 0) {
            yield remainder;
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let delimiterIndex = buffer.indexOf('\n\n');
        while (delimiterIndex !== -1) {
          const chunk = buffer.slice(0, delimiterIndex);
          buffer = buffer.slice(delimiterIndex + 2);
          if (chunk.trim().length > 0) {
            yield chunk;
          }
          delimiterIndex = buffer.indexOf('\n\n');
        }
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

function serializeBody(body: unknown, headers: Record<string, string>): BodyInit | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === 'string' || body instanceof ArrayBuffer || body instanceof Blob) {
    return body;
  }
  if ((body as any) instanceof URLSearchParams) {
    return body as BodyInit;
  }

  if (!headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json';
  }

  return JSON.stringify(body);
}
