import {
  createOrchestrator,
  type ProviderAdapter,
  type NormalizedChatRequest,
  type NormalizedEmbedRequest,
  type ProviderStreamEvent
} from '../src/orchestrator.js';
import type { CallerConfig } from '../src/loadConfig.js';
import { ProviderError, type ProviderErrorClassification } from '../src/providerErrors.js';

class StubAdapter implements ProviderAdapter {
  public readonly name: string;
  public readonly capability: boolean;
  public lastRequest: NormalizedChatRequest | undefined;
  public lastEmbedRequest: NormalizedEmbedRequest | undefined;
  public outcomes: Array<StubOutcome>;
  public readonly embedCapability: boolean;
  public embedOutcomes: Array<{
    vectors: number[][];
    traceId: string;
    providerInfo?: { name: string; model?: string };
    usage?: Record<string, unknown>;
  }>;
  public streamEvents: ProviderStreamEvent[];

  constructor(
    name: string,
    capability: boolean,
    outcomes: Array<StubOutcome>,
    options: {
      embedCapability?: boolean;
      embedOutcomes?: Array<{
        vectors: number[][];
        traceId: string;
        providerInfo?: { name: string; model?: string };
        usage?: Record<string, unknown>;
      }>;
      streamEvents?: ProviderStreamEvent[];
    } = {}
  ) {
    this.name = name;
    this.capability = capability;
    this.outcomes = [...outcomes];
    this.embedCapability = options.embedCapability ?? false;
    this.embedOutcomes = options.embedOutcomes ? [...options.embedOutcomes] : [];
    this.streamEvents = options.streamEvents ? [...options.streamEvents] : [];
  }

  supports(capability: string): boolean {
    if (capability === 'chat') {
      return this.capability;
    }
    if (capability === 'embed') {
      return this.embedCapability;
    }
    return false;
  }

  async chat(request: NormalizedChatRequest) {
    this.lastRequest = request;
    if (this.outcomes.length === 0) {
      throw new Error('No response configured');
    }
    const outcome = this.outcomes.shift();
    if (!outcome) {
      throw new Error('No response configured');
    }
    if (outcome.kind === 'error') {
      throw outcome.error;
    }
    return outcome.response;
  }

  async embed(request: NormalizedEmbedRequest) {
    if (!this.embedCapability) {
      throw new Error('Embed not supported');
    }
    const outcome = this.embedOutcomes.shift();
    if (!outcome) {
      throw new Error('No embed response configured');
    }
    this.lastEmbedRequest = request;
    this.lastRequest = {
      requestId: request.requestId,
      callerTool: request.callerTool,
      messages: []
    };
    return {
      payload: {
        vectors: outcome.vectors,
        usage: outcome.usage,
        providerInfo: outcome.providerInfo ?? { name: this.name }
      },
      traceId: outcome.traceId
    };
  }

  chatStream() {
    const events = this.streamEvents ?? [];
    return (async function* stream() {
      for (const event of events) {
        yield event;
      }
    })();
  }
}

type StubOutcome =
  | { kind: 'success'; response: { payload: unknown; traceId: string } }
  | { kind: 'error'; error: ProviderError };

const baseConfig: CallerConfig = {
  host: '127.0.0.1',
  port: 4037,
  clients: [],
  providers: {
    openai: {
      baseUrl: 'https://api.openai.com',
      defaultModel: 'gpt-4o-mini',
      capabilities: ['chat', 'embed']
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-3-haiku',
      capabilities: ['chat']
    }
  }
};

describe('orchestrator', () => {
  it('uses the default provider and injects default model when none specified', async () => {
    const openaiAdapter = new StubAdapter('openai', true, [
      { kind: 'success', response: { payload: { message: 'ok-openai' }, traceId: 'trace-openai' } }
    ]);
    const anthropicAdapter = new StubAdapter('anthropic', true, [
      { kind: 'success', response: { payload: { message: 'ok-anthropic' }, traceId: 'trace-anthropic' } }
    ]);
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter, anthropicAdapter]);

    const result = await orchestrator.dispatchChat({
      requestId: 'req-1',
      callerTool: 'tool',
      messages: [{ role: 'user', content: 'hi' }]
    });

    expect(result.payload).toEqual(expect.objectContaining({ message: 'ok-openai' }));
    expect((result.payload as any).providerInfo).toEqual({
      name: 'openai',
      model: 'gpt-4o-mini',
      routing: { capability: 'chat', strategy: 'fallback' }
    });
    expect(result.traceId).toBe('trace-openai');
    expect(openaiAdapter.lastRequest?.model).toBe('gpt-4o-mini');
  });

  it('honors explicit provider selection', async () => {
    const openaiAdapter = new StubAdapter('openai', true, [
      { kind: 'success', response: { payload: { message: 'ok-openai' }, traceId: 'trace-openai' } }
    ]);
    const anthropicAdapter = new StubAdapter('anthropic', true, [
      { kind: 'success', response: { payload: { message: 'ok-anthropic' }, traceId: 'trace-anthropic' } }
    ]);
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter, anthropicAdapter]);

    const result = await orchestrator.dispatchChat({
      requestId: 'req-2',
      callerTool: 'tool',
      provider: 'anthropic',
      model: 'claude-3-haiku',
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(result.payload).toEqual(expect.objectContaining({ message: 'ok-anthropic' }));
    expect((result.payload as any).providerInfo).toEqual({
      name: 'anthropic',
      model: 'claude-3-haiku',
      routing: { capability: 'chat', strategy: 'caller-override' }
    });
    expect(anthropicAdapter.lastRequest?.model).toBe('claude-3-haiku');
  });

  it('selects capability defaults when provider not specified', async () => {
    const routingConfig = JSON.parse(
      JSON.stringify({
        ...baseConfig,
        providers: {
          lmstudio_gpu: {
            baseUrl: 'http://localhost:1235/v1',
            defaultModel: 'deepseek-fallback',
            capabilities: ['chat', 'chatStream', 'embed'],
            defaults: {
              chat: 'deepseek-coder-33b',
              chatStream: 'deepseek-coder-33b',
              embed: 'nomic-embed-text'
            },
            scores: {
              coding: 95,
              embeddings: 70
            }
          },
          openai: {
            baseUrl: 'https://api.openai.com',
            defaultModel: 'gpt-4o-mini',
            capabilities: ['chat', 'embed'],
            defaults: {
              chat: 'gpt-4o-mini',
              embed: 'text-embedding-3-small'
            },
            scores: {
              coding: 70,
              embeddings: 85
            }
          }
        }
      })
    ) as CallerConfig;

    const lmstudioAdapter = new StubAdapter(
      'lmstudio_gpu',
      true,
      [
        {
          kind: 'success',
          response: {
            payload: { message: 'lmstudio-response' },
            traceId: 'trace-lmstudio'
          }
        }
      ],
      {
        embedCapability: true,
        embedOutcomes: [
          {
            vectors: [[0.9, 0.1]],
            traceId: 'embed-trace',
            providerInfo: { name: 'lmstudio_gpu', model: 'nomic-embed-text' }
          }
        ]
      }
    );
    const openaiAdapter = new StubAdapter(
      'openai',
      true,
      [
        {
          kind: 'success',
          response: {
            payload: { message: 'openai-response' },
            traceId: 'trace-openai'
          }
        }
      ],
      {
        embedCapability: true,
        embedOutcomes: [
          {
            vectors: [[0.5, 0.2]],
            traceId: 'embed-openai',
            providerInfo: { name: 'openai', model: 'text-embedding-3-small' }
          }
        ]
      }
    );

    const orchestrator = createOrchestrator(routingConfig, [lmstudioAdapter, openaiAdapter]);

    const chatResult = await orchestrator.dispatchChat({
      requestId: 'cap-route-chat',
      callerTool: 'tool',
      messages: [{ role: 'user', content: 'hi' }]
    });

    expect(chatResult.payload).toEqual(expect.objectContaining({ message: 'lmstudio-response' }));
    expect((chatResult.payload as any).providerInfo).toEqual({
      name: 'lmstudio_gpu',
      model: 'deepseek-coder-33b',
      routing: { capability: 'chat', strategy: 'capability-default' }
    });
    expect(lmstudioAdapter.lastRequest?.provider).toBe('lmstudio_gpu');
    expect(lmstudioAdapter.lastRequest?.model).toBe('deepseek-coder-33b');
    expect(openaiAdapter.lastRequest).toBeUndefined();

    const embedResult = await orchestrator.dispatchEmbed({
      requestId: 'cap-route-embed',
      callerTool: 'tool',
      inputs: ['vector-me']
    });

    expect(embedResult.payload.providerInfo).toEqual({
      name: 'lmstudio_gpu',
      model: 'nomic-embed-text',
      routing: { capability: 'embed', strategy: 'capability-default' }
    });
    expect(lmstudioAdapter.lastEmbedRequest?.provider).toBe('lmstudio_gpu');
    expect(lmstudioAdapter.lastEmbedRequest?.model).toBe('nomic-embed-text');
  });

  it('throws when provider is unknown', async () => {
    const openaiAdapter = new StubAdapter('openai', true, [
      { kind: 'success', response: { payload: {}, traceId: 'trace-openai' } }
    ]);
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter]);

    await expect(
      orchestrator.dispatchChat({
        requestId: 'req-3',
        callerTool: 'tool',
        provider: 'does-not-exist',
        messages: [{ role: 'user', content: 'hola' }]
      })
    ).rejects.toThrow('Unknown provider: does-not-exist');
  });

  it('throws when adapter does not support capability', async () => {
    const openaiAdapter = new StubAdapter('openai', false, [
      { kind: 'success', response: { payload: {}, traceId: 'trace-openai' } }
    ]);
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter]);

    await expect(
      orchestrator.dispatchChat({
        requestId: 'req-4',
        callerTool: 'tool',
        messages: [{ role: 'user', content: 'yo' }]
      })
    ).rejects.toThrow('Adapter openai does not support chat capability');
  });

  it('retries temporary errors and returns the first successful response', async () => {
    const openaiAdapter = new StubAdapter('openai', true, [
      { kind: 'error', error: createProviderError('TEMPORARY', 'transient failure') },
      { kind: 'success', response: { payload: { message: 'ok-after-retry' }, traceId: 'trace-after' } }
    ]);
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter]);

    const response = await orchestrator.dispatchChat({
      requestId: 'req-5',
      callerTool: 'tool',
      messages: [{ role: 'user', content: 'retry' }]
    });

    expect(response.payload).toEqual(expect.objectContaining({ message: 'ok-after-retry' }));
    expect((response.payload as any).providerInfo).toEqual({
      name: 'openai',
      model: 'gpt-4o-mini',
      routing: { capability: 'chat', strategy: 'fallback' }
    });
    expect(openaiAdapter.outcomes).toHaveLength(0);
  });

  it('does not retry permanent errors', async () => {
    const openaiAdapter = new StubAdapter('openai', true, [
      { kind: 'error', error: createProviderError('PERMANENT', 'validation failed') }
    ]);
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter]);

    await expect(
      orchestrator.dispatchChat({
        requestId: 'req-6',
        callerTool: 'tool',
        messages: [{ role: 'user', content: 'noRetry' }]
      })
    ).rejects.toThrow(ProviderError);

    expect(openaiAdapter.outcomes).toHaveLength(0);
  });

  it('stops after max attempts for repeated temporary failures', async () => {
    const openaiAdapter = new StubAdapter('openai', true, [
      { kind: 'error', error: createProviderError('TEMPORARY', 'network blip #1') },
      { kind: 'error', error: createProviderError('TEMPORARY', 'network blip #2') },
      { kind: 'success', response: { payload: { message: 'unused' }, traceId: 'trace-unused' } }
    ]);
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter]);

    await expect(
      orchestrator.dispatchChat({
        requestId: 'req-7',
        callerTool: 'tool',
        messages: [{ role: 'user', content: 'retry exhaustion' }]
      })
    ).rejects.toThrow('Provider openai failed after 2 attempts');
  });

  it('dispatches embed to providers declaring embed capability', async () => {
    const openaiAdapter = new StubAdapter(
      'openai',
      true,
      [
        { kind: 'success', response: { payload: { message: 'unused' }, traceId: 'trace-openai' } }
      ],
      {
        embedCapability: true,
        embedOutcomes: [
          {
            vectors: [[0.1, 0.2, 0.3]],
            traceId: 'embed-trace',
            providerInfo: { name: 'openai', model: 'text-embedding-3-small' }
          }
        ]
      }
    );
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter]);

    const response = await orchestrator.dispatchEmbed({
      requestId: 'embed-1',
      callerTool: 'tool',
      inputs: ['Hello world'],
      provider: 'openai',
      model: 'text-embedding-3-small'
    });

    expect(response.payload.vectors).toEqual([[0.1, 0.2, 0.3]]);
    expect(response.payload.providerInfo).toEqual({
      name: 'openai',
      model: 'text-embedding-3-small',
      routing: { capability: 'embed', strategy: 'caller-override' }
    });
    expect(response.traceId).toBe('embed-trace');
  });

  it('throws when adapter lacks embed capability', async () => {
    const openaiAdapter = new StubAdapter('openai', true, [], { embedCapability: false });
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter]);

    await expect(
      orchestrator.dispatchEmbed({
        requestId: 'embed-2',
        callerTool: 'tool',
        inputs: ['Hello'],
        provider: 'openai'
      })
    ).rejects.toThrow('Adapter openai does not support embed capability');
  });

  it('proxies streaming events from adapter', async () => {
    const streamEvents: ProviderStreamEvent[] = [
      { type: 'delta', delta: { content: 'Hel' }, traceId: 'trace-1' },
      { type: 'delta', delta: { content: 'lo' }, traceId: 'trace-1' },
      {
        type: 'completion',
        payload: {
          message: { role: 'assistant', content: 'Hello' },
          usage: { prompt_tokens: 4, completion_tokens: 5 },
          providerInfo: {
            name: 'openai',
            model: 'gpt-4o-mini',
            routing: { capability: 'chatStream', strategy: 'fallback' }
          }
        },
        traceId: 'trace-1'
      }
    ];
    const openaiAdapter = new StubAdapter('openai', true, [], {
      streamEvents
    });
    const orchestrator = createOrchestrator(baseConfig, [openaiAdapter]);

    const collected: ProviderStreamEvent[] = [];
    for await (const event of orchestrator.dispatchChatStream({
      requestId: 'stream-1',
      callerTool: 'tool',
      messages: [{ role: 'user', content: 'Hi' }]
    })) {
      collected.push(event);
    }

    expect(collected).toEqual(streamEvents);
  });
});

function createProviderError(
  classification: ProviderErrorClassification,
  message: string
): ProviderError {
  return new ProviderError(message, classification);
}
