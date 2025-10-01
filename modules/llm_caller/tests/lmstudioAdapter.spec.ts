import { LMStudioAdapter } from '../src/adapters/lmstudioAdapter.js';
import type { AdapterDependencies } from '../src/adapters/types.js';
import type { ProviderConfig } from '../src/loadConfig.js';
import type { HttpRequestOptions, HttpResponse } from '../src/adapters/httpClient.js';
import type {
  NormalizedChatRequest,
  NormalizedEmbedRequest,
  ProviderStreamEvent
} from '../src/orchestrator.js';

class StubHttpClient {
  public readonly calls: Array<{ url: string; options: HttpRequestOptions }> = [];
  private readonly responses: Array<HttpResponse>;
  private readonly streamResponses: Array<string[]>;
  private readonly getResponses: Map<string, HttpResponse> = new Map();

  constructor(responses: Array<HttpResponse>, streamResponses: Array<string[]> = []) {
    this.responses = [...responses];
    this.streamResponses = [...streamResponses];
  }

  registerGet(url: string, response: HttpResponse): void {
    this.getResponses.set(url, response);
  }

  async post<T>(url: string, options: HttpRequestOptions): Promise<HttpResponse<T>> {
    this.calls.push({ url, options });
    const response = this.responses.shift();
    if (!response) {
      throw new Error('No stubbed response');
    }
    return response as HttpResponse<T>;
  }

  async get<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    this.calls.push({ url, options });
    const response = this.getResponses.get(url);
    if (!response) {
      throw new Error(`No stubbed GET response for ${url}`);
    }
    return response as HttpResponse<T>;
  }

  async *postStream(url: string, options: HttpRequestOptions): AsyncIterable<string> {
    this.calls.push({ url, options });
    const events = this.streamResponses.shift();
    if (!events) {
      throw new Error('No stubbed stream response');
    }
    for (const event of events) {
      yield event;
    }
  }
}

class StubSecretsProvider {
  public readonly requestedKeys: string[] = [];

  async getSecret(key: string): Promise<string | undefined> {
    this.requestedKeys.push(key);
    return undefined;
  }
}

describe('LMStudioAdapter', () => {
  const config: ProviderConfig = {
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    capabilities: ['chat', 'embed']
  };

  const request: NormalizedChatRequest = {
    requestId: 'req-789',
    callerTool: 'tool',
    messages: [{ role: 'user', content: 'Ping?' }],
    provider: 'lmstudio',
    model: 'local-model'
  };

  it('sends OpenAI-compatible request without requiring secrets', async () => {
    const httpClient = new StubHttpClient([
      {
        status: 200,
        body: {
          id: 'local-1',
          model: 'local-model',
          choices: [{ message: { role: 'assistant', content: 'Pong!' } }],
          usage: {}
        }
      }
    ]);
    const secretsProvider = new StubSecretsProvider();
    const deps: AdapterDependencies = { httpClient: httpClient as any, secretsProvider };
    const adapter = new LMStudioAdapter(config, deps);

    const response = await adapter.chat(request);

    expect(httpClient.calls).toHaveLength(1);
    const call = httpClient.calls[0];
    expect(call.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(call.options.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(call.options.headers?.Authorization).toBeUndefined();
    expect(call.options.body).toEqual({
      model: 'local-model',
      messages: request.messages
    });
    expect(secretsProvider.requestedKeys).toEqual([]);
    expect(response.payload).toEqual({
      message: { role: 'assistant', content: 'Pong!' },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      providerInfo: { name: 'lmstudio', model: 'local-model' }
    });
  });

  it('supports embeddings without secrets', async () => {
    const httpClient = new StubHttpClient([
      {
        status: 200,
        body: {
          data: [{ embedding: [0.5, 0.6], index: 0 }]
        }
      }
    ]);
    const secretsProvider = new StubSecretsProvider();
    const adapter = new LMStudioAdapter(config, { httpClient: httpClient as any, secretsProvider });

    const embedRequest: NormalizedEmbedRequest = {
      requestId: 'embed-local',
      callerTool: 'tool',
      inputs: ['Hi'],
      model: 'local-embed',
      provider: 'lmstudio'
    };

    const response = await adapter.embed!(embedRequest);

    const call = httpClient.calls[0];
    expect(call.url).toBe('http://localhost:1234/v1/embeddings');
    expect(call.options.body).toEqual({ model: 'local-embed', input: ['Hi'] });
    expect(response.payload.vectors).toEqual([[0.5, 0.6]]);
    expect(response.payload.providerInfo).toEqual({ name: 'lmstudio', model: 'local-embed' });
    expect(response.payload.usage).toEqual({ inputTokens: 0 });
  });

  it('streams chat responses', async () => {
    const streamChunks = [
      'data: {"id":"local-1","choices":[{"delta":{"content":"Lo"}}]}\n\n',
      'data: {"id":"local-1","choices":[{"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ];
    const httpClient = new StubHttpClient([], [streamChunks]);
    const secretsProvider = new StubSecretsProvider();
    const adapter = new LMStudioAdapter(config, { httpClient: httpClient as any, secretsProvider });

    const received: ProviderStreamEvent[] = [];
    for await (const event of adapter.chatStream!(request)) {
      received.push(event);
    }

    expect(received).toEqual([
      { type: 'delta', delta: { content: 'Lo' }, traceId: 'local-1' },
      {
        type: 'completion',
        payload: {
          message: { role: 'assistant', content: 'Lo' },
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          providerInfo: { name: 'lmstudio', model: 'local-model' }
        },
        traceId: 'local-1'
      }
    ]);
  });

  it('lists models via the discovery endpoint', async () => {
    const httpClient = new StubHttpClient([]);
    httpClient.registerGet('http://localhost:1234/v1/models', {
      status: 200,
      body: {
        data: [
          { id: 'deepseek-coder', ready: true },
          { id: 'llama-3', ready: false, context_window: 8192 }
        ]
      }
    });
    const secretsProvider = new StubSecretsProvider();
    const adapter = new LMStudioAdapter(config, { httpClient: httpClient as any, secretsProvider });

    const models = await adapter.listModels!();

    expect(models).toEqual([
      { id: 'deepseek-coder', ready: true },
      { id: 'llama-3', ready: false }
    ]);
  });

  it('reports degraded health when discovery fails', async () => {
    const httpClient = new StubHttpClient([]);
    httpClient.registerGet('http://localhost:1234/v1/models', {
      status: 503,
      body: { error: 'server overloaded' }
    });
    const secretsProvider = new StubSecretsProvider();
    const adapter = new LMStudioAdapter(config, { httpClient: httpClient as any, secretsProvider });

    const result = await adapter.checkHealth!();

    expect(result.status).toBe('degraded');
    expect(result.details).toContain('503');
  });
});
