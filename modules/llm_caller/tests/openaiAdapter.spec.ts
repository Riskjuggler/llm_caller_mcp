import { OpenAIAdapter } from '../src/adapters/openaiAdapter.js';
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

  constructor(responses: Array<HttpResponse>, streamResponses: Array<string[]> = []) {
    this.responses = [...responses];
    this.streamResponses = [...streamResponses];
  }

  async post<T>(url: string, options: HttpRequestOptions): Promise<HttpResponse<T>> {
    this.calls.push({ url, options });
    const response = this.responses.shift();
    if (!response) {
      throw new Error('No stubbed response');
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
  constructor(private readonly secrets: Record<string, string | undefined>) {}

  async getSecret(key: string): Promise<string | undefined> {
    this.requestedKeys.push(key);
    return this.secrets[key];
  }
}

describe('OpenAIAdapter', () => {
  const config: ProviderConfig = {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    capabilities: ['chat', 'embed']
  };

  const request: NormalizedChatRequest = {
    requestId: 'req-123',
    callerTool: 'tool',
    messages: [{ role: 'user', content: 'Hello?' }],
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 50
  };

  it('sends a chat completion request with authorization and normalizes the response', async () => {
    const httpClient = new StubHttpClient([
      {
        status: 200,
        body: {
          id: 'chatcmpl-1',
          model: 'gpt-4o-mini',
          choices: [
            {
              message: { role: 'assistant', content: 'Hi there!' },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
        }
      }
    ]);
    const secretsProvider = new StubSecretsProvider({ OPENAI_API_KEY: 'secret-key' });
    const deps: AdapterDependencies = { httpClient: httpClient as any, secretsProvider };
    const adapter = new OpenAIAdapter(config, deps);

    const response = await adapter.chat(request);

    expect(httpClient.calls).toHaveLength(1);
    const call = httpClient.calls[0];
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.options.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json'
    });
    expect(call.options.body).toEqual({
      model: 'gpt-4o-mini',
      messages: request.messages,
      temperature: 0.2,
      max_tokens: 50
    });

    expect(response.traceId).toBe('chatcmpl-1');
    expect(response.payload).toEqual({
      message: { role: 'assistant', content: 'Hi there!' },
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      providerInfo: { name: 'openai', model: 'gpt-4o-mini' }
    });
    expect(secretsProvider.requestedKeys).toEqual(['OPENAI_API_KEY']);
  });

  it('throws CONFIG error when API key is missing', async () => {
    const httpClient = new StubHttpClient([]);
    const secretsProvider = new StubSecretsProvider({});
    const adapter = new OpenAIAdapter(config, { httpClient: httpClient as any, secretsProvider });

    await expect(adapter.chat(request)).rejects.toMatchObject({
      classification: 'CONFIG',
      message: expect.not.stringContaining('OPENAI_API_KEY')
    });
  });

  it('classifies HTTP 401 as AUTH error', async () => {
    const httpClient = new StubHttpClient([
      {
        status: 401,
        body: { error: { message: 'Unauthorized' } }
      }
    ]);
    const secretsProvider = new StubSecretsProvider({ OPENAI_API_KEY: 'secret-key' });
    const adapter = new OpenAIAdapter(config, { httpClient: httpClient as any, secretsProvider });

    await expect(adapter.chat(request)).rejects.toMatchObject({ classification: 'AUTH' });
  });

  it('classifies HTTP 429 as RATE_LIMIT error', async () => {
    const httpClient = new StubHttpClient([
      {
        status: 429,
        body: { error: { message: 'Too Many Requests' } }
      }
    ]);
    const secretsProvider = new StubSecretsProvider({ OPENAI_API_KEY: 'secret-key' });
    const adapter = new OpenAIAdapter(config, { httpClient: httpClient as any, secretsProvider });

    await expect(adapter.chat(request)).rejects.toMatchObject({ classification: 'RATE_LIMIT' });
  });

  it('wraps network errors as TEMPORARY ProviderError', async () => {
    const httpClient = {
      async post(): Promise<HttpResponse> {
        throw new Error('network down');
      }
    };
    const secretsProvider = new StubSecretsProvider({ OPENAI_API_KEY: 'secret-key' });
    const adapter = new OpenAIAdapter(config, { httpClient: httpClient as any, secretsProvider });

    await expect(adapter.chat(request)).rejects.toMatchObject({ classification: 'TEMPORARY' });
  });

  it('sends embedding request and normalizes vectors', async () => {
    const httpClient = new StubHttpClient([
      {
        status: 200,
        body: {
          data: [
            {
              embedding: [0.01, 0.02, 0.03],
              index: 0,
              object: 'embedding'
            }
          ],
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 5, total_tokens: 5 }
        }
      }
    ]);
    const secretsProvider = new StubSecretsProvider({ OPENAI_API_KEY: 'secret-key' });
    const deps: AdapterDependencies = { httpClient: httpClient as any, secretsProvider };
    const adapter = new OpenAIAdapter(config, deps);

    const embedRequest: NormalizedEmbedRequest = {
      requestId: 'embed-1',
      callerTool: 'tool',
      inputs: ['Hello world'],
      model: 'text-embedding-3-small',
      provider: 'openai'
    };

    const response = await adapter.embed!(embedRequest);

    expect(httpClient.calls).toHaveLength(1);
    const call = httpClient.calls[0];
    expect(call.url).toBe('https://api.openai.com/v1/embeddings');
    expect(call.options.body).toEqual({ model: 'text-embedding-3-small', input: ['Hello world'] });
    expect(response.payload.vectors).toEqual([[0.01, 0.02, 0.03]]);
    expect(response.payload.providerInfo).toEqual({ name: 'openai', model: 'text-embedding-3-small' });
    expect(response.payload.usage).toEqual({ inputTokens: 5, totalTokens: 5 });
    expect(response.traceId).toBe('embed-1');
  });

  it('streams chat responses', async () => {
    const streamChunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":"Hel"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8}}\n\n',
      'data: [DONE]\n\n'
    ];

    const httpClient = new StubHttpClient([], [streamChunks]);
    const secretsProvider = new StubSecretsProvider({ OPENAI_API_KEY: 'secret-key' });
    const adapter = new OpenAIAdapter(config, { httpClient: httpClient as any, secretsProvider });

    const received: ProviderStreamEvent[] = [];
    for await (const event of adapter.chatStream!(request)) {
      received.push(event);
    }

    expect(received).toEqual([
      { type: 'delta', delta: { role: 'assistant', content: 'Hel' }, traceId: 'chatcmpl-1' },
      { type: 'delta', delta: { content: 'lo' }, traceId: 'chatcmpl-1' },
      {
        type: 'completion',
        payload: {
          message: { role: 'assistant', content: 'Hello' },
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
          providerInfo: { name: 'openai', model: 'gpt-4o-mini' }
        },
        traceId: 'chatcmpl-1'
      }
    ]);
  });
});
