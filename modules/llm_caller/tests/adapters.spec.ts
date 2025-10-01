import { createProviderAdapters } from '../src/adapters/index.js';
import type { CallerConfig } from '../src/loadConfig.js';
import type { AdapterDependencies } from '../src/adapters/types.js';

const config: CallerConfig = {
  host: '127.0.0.1',
  port: 4037,
  clients: [],
  providers: {
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
      capabilities: ['chat', 'embed']
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-3-haiku',
      capabilities: ['chat']
    },
    lmstudio: {
      baseUrl: 'http://localhost:1234/v1',
      defaultModel: 'local-model',
      capabilities: ['chat', 'embed']
    }
  }
};

const deps: AdapterDependencies = {
  httpClient: {
    async post() {
      throw new Error('HTTP client not implemented for scaffold test');
    },
    async get() {
      throw new Error('HTTP client not implemented for scaffold test');
    }
  },
  secretsProvider: {
    async getSecret() {
      return undefined;
    }
  }
};

describe('provider adapter scaffolds', () => {
  it('creates adapters for configured providers with capabilities intact', () => {
    const adapters = createProviderAdapters(config, deps);

    const names = adapters.map((adapter) => adapter.name);
    expect(names).toEqual(['openai', 'anthropic', 'lmstudio']);

    const openai = adapters[0];
    const anthropic = adapters[1];
    const lmstudio = adapters[2];

    expect(openai.supports('chat')).toBe(true);
    expect(openai.supports('embed')).toBe(true);
    expect(anthropic.supports('embed')).toBe(false);
    expect(lmstudio.supports('chat')).toBe(true);
  });

  it('maps custom lmstudio keys to LMStudioAdapter', () => {
    const aliasConfig: CallerConfig = {
      ...config,
      providers: {
        'lmstudio-chat': {
          baseUrl: 'http://localhost:1234/v1',
          defaultModel: 'meta-llama-3.1-8b-instruct',
          capabilities: ['chat', 'chatStream']
        }
      }
    };

    const adapters = createProviderAdapters(aliasConfig, deps);
    expect(adapters).toHaveLength(1);
    expect(adapters[0].name).toBe('lmstudio-chat');
    expect(adapters[0].supports('chat')).toBe(true);
    expect(adapters[0].supports('embed')).toBe(false);
  });
});
