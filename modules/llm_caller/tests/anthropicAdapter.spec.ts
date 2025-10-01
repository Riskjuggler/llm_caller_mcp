import { AnthropicAdapter } from '../src/adapters/anthropicAdapter.js';
import type { AdapterDependencies } from '../src/adapters/types.js';
import type { ProviderConfig } from '../src/loadConfig.js';
import type { HttpRequestOptions, HttpResponse } from '../src/adapters/httpClient.js';
import type { NormalizedChatRequest } from '../src/orchestrator.js';

class StubHttpClient {
  public readonly calls: Array<{ url: string; options: HttpRequestOptions }> = [];
  private readonly responses: Array<HttpResponse>;

  constructor(responses: Array<HttpResponse>) {
    this.responses = [...responses];
  }

  async post<T>(url: string, options: HttpRequestOptions): Promise<HttpResponse<T>> {
    this.calls.push({ url, options });
    const response = this.responses.shift();
    if (!response) {
      throw new Error('No stubbed response');
    }
    return response as HttpResponse<T>;
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

describe('AnthropicAdapter', () => {
  const config: ProviderConfig = {
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-haiku',
    capabilities: ['chat']
  };

  const request: NormalizedChatRequest = {
    requestId: 'req-456',
    callerTool: 'tool',
    messages: [{ role: 'user', content: 'Help?' }],
    provider: 'anthropic',
    model: 'claude-3-haiku',
    temperature: 0.5,
    maxTokens: 100
  };

  it('sends a messages request with anthropic headers and normalizes the response', async () => {
    const httpClient = new StubHttpClient([
      {
        status: 200,
        body: {
          id: 'msg_123',
          model: 'claude-3-haiku',
          content: [{ type: 'text', text: 'Greetings!' }],
          usage: { input_tokens: 20, output_tokens: 30 }
        }
      }
    ]);
    const secretsProvider = new StubSecretsProvider({ ANTHROPIC_API_KEY: 'anthropic-key' });
    const deps: AdapterDependencies = { httpClient: httpClient as any, secretsProvider };
    const adapter = new AnthropicAdapter(config, deps);

    const response = await adapter.chat(request);

    expect(httpClient.calls).toHaveLength(1);
    const call = httpClient.calls[0];
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.options.headers).toMatchObject({
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    });
    expect(call.options.body).toEqual({
      model: 'claude-3-haiku',
      messages: request.messages,
      temperature: 0.5,
      max_tokens: 100
    });

    expect(response.traceId).toBe('msg_123');
    expect(response.payload).toEqual({
      message: { role: 'assistant', content: 'Greetings!' },
      usage: { inputTokens: 20, outputTokens: 30 },
      providerInfo: { name: 'anthropic', model: 'claude-3-haiku' }
    });
    expect(secretsProvider.requestedKeys).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('throws CONFIG error when API key is missing', async () => {
    const httpClient = new StubHttpClient([]);
    const secretsProvider = new StubSecretsProvider({});
    const adapter = new AnthropicAdapter(config, { httpClient: httpClient as any, secretsProvider });

    await expect(adapter.chat(request)).rejects.toMatchObject({
      classification: 'CONFIG',
      message: expect.not.stringContaining('ANTHROPIC_API_KEY')
    });
  });
});
