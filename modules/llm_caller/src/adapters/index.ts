import type { ProviderAdapter } from '../orchestrator.js';
import type { CallerConfig, ProviderConfig } from '../loadConfig.js';
import { ProviderError } from '../providerErrors.js';
import { AnthropicAdapter } from './anthropicAdapter.js';
import { LMStudioAdapter } from './lmstudioAdapter.js';
import { OpenAIAdapter } from './openaiAdapter.js';
import { BaseProviderAdapter } from './baseAdapter.js';
import type { AdapterDependencies } from './types.js';
import { FetchHttpClient } from './fetchHttpClient.js';
import { EnvSecretsProvider } from '../secrets/envSecretsProvider.js';

export function createDefaultAdapterDependencies(): AdapterDependencies {
  return {
    httpClient: new FetchHttpClient(),
    secretsProvider: new EnvSecretsProvider()
  };
}

export function createProviderAdapters(config: CallerConfig, deps: AdapterDependencies): ProviderAdapter[] {
  return Object.entries(config.providers).map(([providerKey, providerConfig]) =>
    createAdapter(providerKey, providerConfig, deps)
  );
}

function createAdapter(
  providerKey: string,
  providerConfig: ProviderConfig,
  deps: AdapterDependencies
): ProviderAdapter {
  switch (providerKey) {
    case 'openai':
      return new OpenAIAdapter(providerConfig, deps);
    case 'anthropic':
      return new AnthropicAdapter(providerConfig, deps);
    case 'lmstudio':
      return new LMStudioAdapter(providerConfig, deps, providerKey);
    default:
      if (providerKey.toLowerCase().startsWith('lmstudio')) {
        return new LMStudioAdapter(providerConfig, deps, providerKey);
      }
      return new UnsupportedProviderAdapter(providerKey, providerConfig);
  }
}

class UnsupportedProviderAdapter extends BaseProviderAdapter {
  constructor(providerKey: string, providerConfig: ProviderConfig) {
    super(providerKey, providerConfig);
  }

  async chat(): Promise<never> {
    throw new ProviderError(`Provider ${this.name} adapter not registered`, 'CONFIG');
  }
}
