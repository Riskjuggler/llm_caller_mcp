export interface HttpRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
  headers?: Record<string, string>;
}

export interface HttpClient {
  post<T = unknown>(url: string, options: HttpRequestOptions): Promise<HttpResponse<T>>;
  get<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
  postStream?(url: string, options: HttpRequestOptions): AsyncIterable<string>;
}
