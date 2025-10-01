import type { NormalizedChatRequest, ProviderAdapter, ProviderResponse } from '../orchestrator.js';
import type { ProviderConfig } from '../loadConfig.js';

export abstract class BaseProviderAdapter implements ProviderAdapter {
  private readonly capabilitySet: Set<string>;

  protected constructor(
    public readonly name: string,
    protected readonly providerConfig: ProviderConfig
  ) {
    this.capabilitySet = new Set(providerConfig.capabilities ?? []);
  }

  supports(capability: string): boolean {
    return this.capabilitySet.has(capability);
  }

  abstract chat(request: NormalizedChatRequest): Promise<ProviderResponse<unknown>>;
}
