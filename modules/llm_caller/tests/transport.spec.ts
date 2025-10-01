import { createServer } from '../src/transport.js';
import { createLogger } from '../src/logger.js';
import type { CallerConfig } from '../src/loadConfig.js';
import type {
  EmbedResponsePayload,
  Orchestrator,
  ProviderResponse,
  NormalizedChatRequest,
  NormalizedEmbedRequest,
  ProviderStreamEvent,
  ModelDescriptor,
  ProviderHealth
} from '../src/orchestrator.js';
import { ProviderError } from '../src/providerErrors.js';
import { getMetricsSnapshot, resetMetrics } from '../src/metrics.js';

const baseConfig: CallerConfig = {
  host: '127.0.0.1',
  port: 0,
  clients: [
    {
      toolId: 'test-tool',
      token: 'secret-token',
      allowedMethods: ['chat', 'chatStream', 'embed', 'models', 'getHealth']
    }
  ],
  providers: {
    fake: {
      baseUrl: 'http://fake',
      defaultModel: 'fake-model',
      capabilities: ['chat']
    }
  }
};

class FakeOrchestrator implements Orchestrator {
  public lastRequest: NormalizedChatRequest | undefined;
  public lastEmbedRequest: NormalizedEmbedRequest | undefined;
  public streamEvents: ProviderStreamEvent[] = [];
  public streamError: Error | undefined;
  public modelListings: Record<string, ModelDescriptor[]> = {
    fake: [
      { id: 'fake-model', ready: true, defaults: ['chat'] },
      { id: 'fallback', ready: true, defaults: ['embed'] }
    ]
  };
  public healthStatuses: Record<string, ProviderHealth> = {
    fake: { status: 'ok' }
  };

  async dispatchChat(request: NormalizedChatRequest): Promise<ProviderResponse<unknown>> {
    this.lastRequest = request;
    return {
      payload: {
        requestId: request.requestId,
        message: { role: 'assistant', content: 'hello' },
        usage: { inputTokens: 1, outputTokens: 1 },
        providerInfo: {
          name: 'fake',
          model: request.model ?? 'fake-model',
          routing: {
            capability: 'chat',
            strategy: request.provider ? 'caller-override' : 'capability-default'
          }
        }
      },
      traceId: 'trace-123'
    };
  }

  async *dispatchChatStream(_request: NormalizedChatRequest): AsyncIterable<ProviderStreamEvent> {
    if (this.streamError) {
      throw this.streamError;
    }
    for (const event of this.streamEvents) {
      yield event;
    }
  }

  async dispatchEmbed(request: NormalizedEmbedRequest): Promise<ProviderResponse<EmbedResponsePayload>> {
    this.lastEmbedRequest = request;
    return {
      payload: {
        vectors: [[0.1, 0.2]],
        usage: { inputTokens: 2 },
        providerInfo: {
          name: 'fake',
          model: 'fake-embed',
          routing: {
            capability: 'embed',
            strategy: request.provider ? 'caller-override' : 'capability-default'
          }
        }
      },
      traceId: 'embed-trace'
    };
  }

  async listModels(options: { provider?: string } = {}): Promise<{ provider: string; models: ModelDescriptor[] }> {
    const provider = options.provider ?? 'fake';
    const models = this.modelListings[provider];
    if (!models) {
      throw new Error(`No models for ${provider}`);
    }
    return { provider, models };
  }

  async checkProviderHealth(provider: string): Promise<ProviderHealth> {
    return this.healthStatuses[provider] ?? { status: 'ok' };
  }
}

describe('transport', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('rejects non-loopback access', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chat',
      payload: {},
      remoteAddress: '10.0.0.5',
      headers: { 'x-llm-caller-token': 'secret-token' }
    } as any);

    expect(response.statusCode).toBe(403);
  });

  it('rejects missing token', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chat',
      payload: {},
      remoteAddress: '127.0.0.1'
    } as any);

    expect(response.statusCode).toBe(401);
  });

  it('dispatches chat for authorized client', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chat',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'req-1',
        callerTool: 'ignored',
        messages: [
          {
            role: 'user',
            content: 'hi'
          }
        ]
      }
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.message.content).toBe('hello');
    expect(orchestrator.lastRequest?.callerTool).toBe('test-tool');
    expect(body.retryAfterMs).toBeUndefined();
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.chat).toEqual({ total: 1, success: 1, error: 0 });
  });

  it('includes routing metadata in chat responses', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chat',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'route-1',
        callerTool: 'test-tool',
        messages: [{ role: 'user', content: 'hi' }]
      }
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.providerInfo.routing).toEqual({ capability: 'chat', strategy: 'capability-default' });
  });

  it('clamps retry hint for chat success responses', async () => {
    const orchestrator: Orchestrator = {
      async dispatchChat(request) {
        return {
          payload: { message: { role: 'assistant', content: 'ok' } },
          traceId: 'retry-clamp',
          retryAfterMs: 120_000
        };
      },
      dispatchChatStream: () => (async function* () {})(),
      async dispatchEmbed() {
        return {
          payload: { vectors: [], providerInfo: { name: 'fake' } },
          traceId: 'unused'
        };
      },
      async listModels() {
        return { provider: 'fake', models: [] };
      },
      async checkProviderHealth() {
        return { status: 'ok' };
      }
    };

    const server = createServer(baseConfig, orchestrator, createLogger());
    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chat',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'retry-2',
        callerTool: 'test-tool',
        messages: [{ role: 'user', content: 'hi' }]
      }
    } as any);

    expect(response.statusCode).toBe(200);
    expect(response.headers['retry-after']).toBe('60');
    const body = response.json() as any;
    expect(body.retryAfterMs).toBe(60_000);
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.chat.success).toBe(1);
  });

  it('dispatches embed for authorized client', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/embed',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'embed-1',
        callerTool: 'test-tool',
        inputs: ['hello'],
        model: 'text-embedding-3-small'
      }
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.vectors).toEqual([[0.1, 0.2]]);
    expect(body.providerInfo).toEqual({
      name: 'fake',
      model: 'fake-embed',
      routing: { capability: 'embed', strategy: 'capability-default' }
    });
    expect(body.usage).toEqual({ inputTokens: 2 });
    expect(body.traceId).toBe('embed-trace');
    expect(orchestrator.lastEmbedRequest?.inputs).toEqual(['hello']);
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.embed).toEqual({ total: 1, success: 1, error: 0 });
  });

  it('rejects model listing when client lacks permission', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(
      {
        ...baseConfig,
        clients: [
          {
            toolId: 'test-tool',
            token: 'secret-token',
            allowedMethods: ['chat', 'chatStream', 'embed', 'getHealth']
          }
        ]
      },
      orchestrator,
      createLogger()
    );

    const response = await server.instance.inject({
      method: 'GET',
      url: '/mcp/models',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' }
    } as any);

    expect(response.statusCode).toBe(403);
  });

  it('returns provider models for authorized client', async () => {
    const orchestrator = new FakeOrchestrator();
    orchestrator.modelListings = {
      fake: [
        { id: 'lmstudio-a', ready: true, defaults: ['chat'] },
        { id: 'lmstudio-b', ready: false, defaults: ['embed'] }
      ]
    };
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'GET',
      url: '/mcp/models?provider=fake',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' }
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.provider).toBe('fake');
    expect(body.models).toEqual([
      expect.objectContaining({ id: 'lmstudio-a', ready: true, defaults: expect.any(Array) }),
      expect.objectContaining({ id: 'lmstudio-b', ready: false, defaults: expect.any(Array) })
    ]);
    for (const model of body.models) {
      expect(typeof model.id).toBe('string');
      expect(typeof model.ready).toBe('boolean');
    }
  });

  it('reports provider health status', async () => {
    const orchestrator = new FakeOrchestrator();
    orchestrator.healthStatuses = {
      fake: {
        status: 'degraded',
        details: 'timeout',
        capabilityCoverage: [
          { capability: 'chat', status: 'ready' },
          { capability: 'embed', status: 'degraded' }
        ]
      } as unknown as ProviderHealth
    };
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' }
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.status).toBe('degraded');
    expect(body.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'provider:fake', status: 'degraded' })
      ])
    );
    const providerComponent = body.components.find((entry: any) => entry.name === 'provider:fake');
    expect(providerComponent.details).toBe('timeout');
    expect(providerComponent.capabilityCoverage).toEqual([
      { capability: 'chat', status: 'ready' },
      { capability: 'embed', status: 'degraded' }
    ]);
  });

  it('marks overall health as failed when a provider probe fails', async () => {
    const orchestrator = new FakeOrchestrator();
    orchestrator.healthStatuses = {
      fake: { status: 'failed', details: 'health probe failed' }
    };
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' }
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.status).toBe('failed');
    const providerComponent = body.components.find((entry: any) => entry.name === 'provider:fake');
    expect(providerComponent.status).toBe('failed');
    expect(providerComponent.details).toBe('health probe failed');
  });

  it('propagates provider errors for embed requests', async () => {
    const orchestrator: Orchestrator = {
      async dispatchChat() {
        return {
          payload: {},
          traceId: 'unused'
        };
      },
      dispatchChatStream: () => (async function* () {})(),
      async dispatchEmbed() {
        throw new ProviderError('Credential missing', 'AUTH', { retryAfterMs: 3_000 });
      },
      async listModels() {
        return { provider: 'fake', models: [] };
      },
      async checkProviderHealth() {
        return { status: 'ok' };
      }
    };
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/embed',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'embed-fail',
        callerTool: 'test-tool',
        inputs: ['data']
      }
    } as any);

    expect(response.statusCode).toBe(502);
    expect(response.headers['retry-after']).toBe('3');
    const body = response.json() as any;
    expect(body).toEqual({
      error: 'AUTH',
      message: 'Provider authentication failed.',
      retryAfterMs: 3000,
      traceId: 'embed-fail'
    });
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.embed.error).toBe(1);
  });

  it('consumes embed rate limit once per request', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(
      {
        ...baseConfig,
        rateLimit: {
          maxRequests: 1,
          intervalMs: 1_000
        }
      } as CallerConfig,
      orchestrator,
      createLogger()
    );

    const first = await server.instance.inject({
      method: 'POST',
      url: '/mcp/embed',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'embed-rate-1',
        callerTool: 'test-tool',
        inputs: ['hello world']
      }
    } as any);

    expect(first.statusCode).toBe(200);

    const throttled = await server.instance.inject({
      method: 'POST',
      url: '/mcp/embed',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'embed-rate-2',
        callerTool: 'test-tool',
        inputs: ['second call']
      }
    } as any);

    expect(throttled.statusCode).toBe(429);
  });

  it('streams chat responses via SSE', async () => {
    const orchestrator = new FakeOrchestrator();
    orchestrator.streamEvents = [
      { type: 'delta', delta: { content: 'Hel' }, traceId: 'trace-123' },
      { type: 'delta', delta: { content: 'lo' }, traceId: 'trace-123' },
      {
        type: 'completion',
        payload: {
          message: { role: 'assistant', content: 'Hello' },
          providerInfo: { name: 'fake', model: 'fake-model' },
          usage: { inputTokens: 1, outputTokens: 2 }
        },
        traceId: 'trace-123'
      }
    ];
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chatStream',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'stream-1',
        callerTool: 'test-tool',
        messages: [{ role: 'user', content: 'Say hi' }]
      }
    } as any);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const chunks = response.body.trim().split('\n\n');
    expect(chunks).toEqual([
      `data: ${JSON.stringify(orchestrator.streamEvents[0])}`,
      `data: ${JSON.stringify(orchestrator.streamEvents[1])}`,
      `data: ${JSON.stringify(orchestrator.streamEvents[2])}`,
      'data: [DONE]'
    ]);
  });

  it('sanitizes streaming payloads before emitting', async () => {
    const orchestrator = new FakeOrchestrator();
    orchestrator.streamEvents = [
      {
        type: 'delta',
        delta: { content: 'A'.repeat(4_100) + String.fromCharCode(7) },
        traceId: 'trace-sanitize'
      }
    ];
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chatStream',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'stream-sanitize',
        callerTool: 'test-tool',
        messages: [{ role: 'user', content: 'Sanitize' }]
      }
    } as any);

    const chunks = response.body.trim().split('\n\n');
    const event = JSON.parse(chunks[0].slice(6));
    expect(event.delta.content.length).toBe(4_000);
    expect(event.delta.content.includes('\u0007')).toBe(false);
    expect(chunks[1]).toBe('data: [DONE]');
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.chatStream.success).toBe(1);
  });

  it('drops non-text streaming payloads', async () => {
    const orchestrator = new FakeOrchestrator();
    orchestrator.streamEvents = [
      {
        type: 'delta',
        delta: { content: String.fromCharCode(1) + String.fromCharCode(2) + 'Binary' },
        traceId: 'trace-binary'
      }
    ];
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chatStream',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'stream-binary',
        callerTool: 'test-tool',
        messages: [{ role: 'user', content: 'Drop binary' }]
      }
    } as any);

    expect(response.statusCode).toBe(200);
    const chunks = response.body.trim().split('\n\n');
    expect(chunks).toEqual(['data: [DONE]']);
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.chatStream.success).toBe(1);
  });

  it('emits retry hints when stream fails with provider error', async () => {
    const orchestrator = new FakeOrchestrator();
    orchestrator.streamError = new ProviderError('Rate limited', 'RATE_LIMIT', { retryAfterMs: 5000 });
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chatStream',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'stream-err',
        callerTool: 'test-tool',
        messages: [{ role: 'user', content: 'Cause error' }]
      }
    } as any);

    expect(response.statusCode).toBe(200);
    const chunks = response.body.trim().split('\n\n');
    expect(chunks).toEqual([
      `data: ${JSON.stringify({ error: 'RATE_LIMIT', message: 'Provider rate limited the request.', retryAfterMs: 5000 })}`,
      'data: [DONE]'
    ]);
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.chatStream.error).toBe(1);
  });

  it('throttles repeated chat requests from the same token', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(
      {
        ...baseConfig,
        rateLimit: {
          maxRequests: 1,
          intervalMs: 1000
        }
      } as CallerConfig,
      orchestrator,
      createLogger()
    );

    const first = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chat',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'rate-0',
        callerTool: 'tool',
        messages: [{ role: 'user', content: 'hello' }]
      }
    } as any);

    expect(first.statusCode).toBe(200);

    const throttled = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chat',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'rate-over',
        callerTool: 'tool',
        messages: [{ role: 'user', content: 'too many' }]
      }
    } as any);

    expect(throttled.statusCode).toBe(429);
    const body = throttled.json() as any;
    expect(body.error).toBe('RATE_LIMIT');
    expect(body.message).toMatch(/too many requests/i);
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.chat).toEqual({ total: 2, success: 1, error: 1 });
  });

  it('returns retry metadata when chat fails with provider error', async () => {
    const orchestrator: Orchestrator = {
      async dispatchChat() {
        throw new ProviderError('Rate limited', 'RATE_LIMIT', { retryAfterMs: 5000 });
      },
      dispatchChatStream: () => (async function* () {})(),
      async dispatchEmbed() {
        return {
          payload: {
            vectors: [],
            providerInfo: { name: 'fake' }
          },
          traceId: 'unused'
        };
      },
      async listModels() {
        return { provider: 'fake', models: [] };
      },
      async checkProviderHealth() {
        return { status: 'ok' };
      }
    };
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'POST',
      url: '/mcp/chat',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' },
      payload: {
        requestId: 'retry-1',
        callerTool: 'test-tool',
        provider: 'fake',
        messages: [{ role: 'user', content: 'hi' }]
      }
    } as any);

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('5');
    const body = response.json() as any;
    expect(body).toEqual({
      error: 'RATE_LIMIT',
      message: 'Provider rate limited the request.',
      retryAfterMs: 5000,
      traceId: 'retry-1'
    });
    const metrics = getMetricsSnapshot();
    expect(metrics.requests.chat.error).toBe(1);
    expect(metrics.providers.fake.error).toBe(1);
  });

  it('reports component status in health response', async () => {
    const orchestrator = new FakeOrchestrator();
    const server = createServer(baseConfig, orchestrator, createLogger());

    const response = await server.instance.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '127.0.0.1',
      headers: { 'x-llm-caller-token': 'secret-token' }
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.status).toBe('ok');
    expect(Array.isArray(body.components)).toBe(true);
    const componentNames = body.components.map((entry: any) => entry.name);
    expect(componentNames).toEqual(expect.arrayContaining(['transport', 'orchestrator', 'provider:fake']));
    for (const component of body.components) {
      expect(typeof component.status).toBe('string');
      expect(typeof component.timestamp).toBe('string');
    }
  });
});
