import type { CallerConfig, ProviderConfig } from './loadConfig.js';
import {
  ProviderError,
  isProviderError,
  isRetryable
} from './providerErrors.js';

export interface NormalizedChatRequest {
  requestId: string;
  callerTool: string;
  messages: Array<{ role: string; content: string }>;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderResponse<TPayload> {
  payload: TPayload;
  traceId: string;
  retryAfterMs?: number;
  attempts?: number;
}

export interface ProviderAdapter {
  name: string;
  supports: (capability: string) => boolean;
  chat: (request: NormalizedChatRequest) => Promise<ProviderResponse<unknown>>;
  chatStream?: (request: NormalizedChatRequest) => AsyncIterable<ProviderStreamEvent>;
  embed?: (request: NormalizedEmbedRequest) => Promise<ProviderResponse<EmbedResponsePayload>>;
  listModels?: () => Promise<ModelDescriptor[]>;
  checkHealth?: () => Promise<ProviderHealth>;
}

type RoutingStrategy = 'capability-default' | 'caller-override' | 'fallback';

interface RoutingMetadata {
  capability: string;
  strategy: RoutingStrategy;
}

interface RoutingSelection {
  providerKey: string;
  model: string;
  strategy: RoutingStrategy;
}

export interface ProviderStreamEvent {
  type: 'delta' | 'completion';
  delta?: { role?: string; content?: string };
  payload?: {
    message: { role: string; content: string };
    usage?: Record<string, unknown>;
    providerInfo: { name: string; model?: string; routing?: RoutingMetadata };
  };
  traceId?: string;
}

export type ProviderHealthStatus = 'ok' | 'degraded' | 'failed';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  details?: string;
  capabilityCoverage?: Array<{ capability: string; status: ProviderHealthStatus }>;
}

export interface ModelDescriptor {
  id: string;
  ready: boolean;
  description?: string;
  defaults?: string[];
  scores?: Record<string, number>;
}

export interface NormalizedEmbedRequest {
  requestId: string;
  callerTool: string;
  inputs: Array<string | number[]>;
  provider?: string;
  model?: string;
}

export interface EmbedResponsePayload {
  vectors: number[][];
  usage?: Record<string, unknown>;
  providerInfo: { name: string; model?: string; routing?: RoutingMetadata };
}

export interface Orchestrator {
  dispatchChat: (request: NormalizedChatRequest) => Promise<ProviderResponse<unknown>>;
  dispatchChatStream: (request: NormalizedChatRequest) => AsyncIterable<ProviderStreamEvent>;
  dispatchEmbed: (request: NormalizedEmbedRequest) => Promise<ProviderResponse<EmbedResponsePayload>>;
  listModels: (options?: { provider?: string }) => Promise<{ provider: string; models: ModelDescriptor[] }>;
  checkProviderHealth: (provider: string) => Promise<ProviderHealth>;
}

export function createOrchestrator(config: CallerConfig, adapters: ProviderAdapter[]): Orchestrator {
  const maxAttempts = resolveMaxAttempts(config);
  return {
    async dispatchChat(request) {
      const routing = resolveRoutingSelection('chat', request, config.providers);
      const providerConfig = config.providers[routing.providerKey];
      const adapter = selectAdapter(routing.providerKey, providerConfig, adapters, 'chat');
      const normalizedRequest = normalizeChatRequest(
        request,
        routing.providerKey,
        providerConfig,
        routing.model
      );
      const { result, attempts } = await executeWithRetry(
        async () => adapter.chat(normalizedRequest),
        routing.providerKey,
        maxAttempts
      );
      const resolvedModel = normalizedRequest.model ?? routing.model;
      const payload = attachRoutingMetadata(result.payload, {
        provider: routing.providerKey,
        model: resolvedModel,
        capability: 'chat',
        strategy: routing.strategy
      });
      return { ...result, payload, attempts };
    },
    dispatchChatStream(request) {
      const routing = resolveRoutingSelection('chatStream', request, config.providers);
      const providerConfig = config.providers[routing.providerKey];
      const adapter = selectAdapter(routing.providerKey, providerConfig, adapters, 'chat');
      if (!adapter.chatStream) {
        throw new Error(`Adapter ${routing.providerKey} does not support chat streaming`);
      }
      const normalizedRequest = normalizeChatRequest(
        request,
        routing.providerKey,
        providerConfig,
        routing.model
      );
      const stream = adapter.chatStream(normalizedRequest);
      return attachRoutingToStream(stream, {
        provider: routing.providerKey,
        model: normalizedRequest.model ?? routing.model,
        capability: 'chatStream',
        strategy: routing.strategy
      });
    },
    async dispatchEmbed(request) {
      const routing = resolveRoutingSelection('embed', request, config.providers);
      const providerConfig = config.providers[routing.providerKey];
      const adapter = selectAdapter(routing.providerKey, providerConfig, adapters, 'embed');
      if (!adapter.embed) {
        throw new Error(`Adapter ${routing.providerKey} does not support embed capability`);
      }
      const normalizedRequest = normalizeEmbedRequest(
        request,
        routing.providerKey,
        providerConfig,
        routing.model
      );
      const response = await adapter.embed(normalizedRequest);
      const resolvedModel = normalizedRequest.model ?? routing.model;
      const payload = attachRoutingMetadata(response.payload, {
        provider: routing.providerKey,
        model: resolvedModel,
        capability: 'embed',
        strategy: routing.strategy
      }) as EmbedResponsePayload;
      return { ...response, payload, attempts: 1 };
    },
    async listModels(options = {}) {
      const providerKey = resolveProviderKey(options, config.providers);
      const adapter = getRegisteredAdapter(providerKey, adapters);
      if (!adapter.listModels) {
        throw new Error(`Adapter ${providerKey} does not support model discovery`);
      }
      const models = await adapter.listModels();
      const providerConfig = config.providers[providerKey];
      const enriched = enrichModelMetadata(models, providerConfig);
      return { provider: providerKey, models: enriched };
    },
    async checkProviderHealth(providerKey: string) {
      if (!config.providers[providerKey]) {
        throw new Error(`Unknown provider: ${providerKey}`);
      }
      const adapter = getRegisteredAdapter(providerKey, adapters);
      if (adapter.checkHealth) {
        const health = await adapter.checkHealth();
        if (!health.capabilityCoverage) {
          health.capabilityCoverage = buildCapabilityCoverage(
            config.providers[providerKey],
            health.status
          );
        }
        return health;
      }
      return {
        status: 'ok',
        details: 'Health probe not implemented',
        capabilityCoverage: buildCapabilityCoverage(config.providers[providerKey], 'ok')
      };
    }
  };
}

function resolveMaxAttempts(config: CallerConfig): number {
  const configured = config.retry?.maxAttempts;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 1) {
    return Math.floor(configured);
  }
  return 2;
}

function resolveProviderKey(
  request: { provider?: string },
  providers: Record<string, ProviderConfig>
): string {
  const providerKey = request.provider ?? Object.keys(providers)[0];
  if (!providerKey) {
    throw new Error('No providers configured');
  }

  if (!providers[providerKey]) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }

  return providerKey;
}

function selectAdapter(
  providerKey: string,
  providerConfig: ProviderConfig,
  adapters: ProviderAdapter[],
  capability: string
): ProviderAdapter {
  const adapter = getRegisteredAdapter(providerKey, adapters);

  if (!adapter.supports(capability)) {
    throw new Error(`Adapter ${providerKey} does not support ${capability} capability`);
  }

  validateCapability(providerConfig, capability, providerKey);

  return adapter;
}

function getRegisteredAdapter(providerKey: string, adapters: ProviderAdapter[]): ProviderAdapter {
  const adapter = adapters.find((entry) => entry.name === providerKey);
  if (!adapter) {
    throw new Error(`Adapter not registered for provider: ${providerKey}`);
  }
  return adapter;
}

function validateCapability(providerConfig: ProviderConfig, capability: string, providerKey: string): void {
  if (!providerConfig.capabilities.includes(capability)) {
    throw new Error(`Provider ${providerKey} does not declare capability: ${capability}`);
  }
}

function normalizeChatRequest(
  request: NormalizedChatRequest,
  providerKey: string,
  providerConfig: ProviderConfig,
  modelOverride?: string
): NormalizedChatRequest {
  const model = modelOverride ?? request.model ?? providerConfig.defaultModel;
  return {
    ...request,
    provider: providerKey,
    model
  };
}

function normalizeEmbedRequest(
  request: NormalizedEmbedRequest,
  providerKey: string,
  providerConfig: ProviderConfig,
  modelOverride?: string
): NormalizedEmbedRequest {
  const model = modelOverride ?? request.model ?? providerConfig.defaultModel;
  return {
    ...request,
    provider: providerKey,
    model
  };
}

function resolveRoutingSelection(
  capability: string,
  request: { provider?: string; model?: string },
  providers: Record<string, ProviderConfig>
): RoutingSelection {
  if (request.provider) {
    const providerConfig = providers[request.provider];
    if (!providerConfig) {
      throw new Error(`Unknown provider: ${request.provider}`);
    }
    const model = request.model ?? providerConfig.defaults?.[capability] ?? providerConfig.defaultModel;
    return {
      providerKey: request.provider,
      model,
      strategy: 'caller-override'
    };
  }

  const entries = Object.entries(providers);
  if (entries.length === 0) {
    throw new Error('No providers configured');
  }

  let best: { key: string; index: number; score: number; model: string; strategy: RoutingStrategy } | undefined;

  entries.forEach(([key, config], index) => {
    if (!config.capabilities.includes(capability)) {
      return;
    }
    const hasDefault = Boolean(config.defaults?.[capability]);
    const baseScore = config.scores?.[capability] ?? 0;
    const score = baseScore + (hasDefault ? 50 : 0);
    const model = config.defaults?.[capability] ?? config.defaultModel;
    const strategy: RoutingStrategy = hasDefault ? 'capability-default' : 'fallback';

    if (!best || score > best.score || (score === best.score && index < best.index)) {
      best = { key, index, score, model, strategy };
    }
  });

  if (best) {
    return {
      providerKey: best.key,
      model: best.model,
      strategy: best.strategy
    };
  }

  const [fallbackKey, fallbackConfig] = entries[0];
  return {
    providerKey: fallbackKey,
    model: fallbackConfig.defaultModel,
    strategy: 'fallback'
  };
}

function attachRoutingMetadata(
  payload: unknown,
  context: { provider: string; model: string; capability: string; strategy: RoutingStrategy }
) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const existing = (payload as any).providerInfo ?? {};
  return {
    ...(payload as Record<string, unknown>),
    providerInfo: {
      name: existing.name ?? context.provider,
      model: existing.model ?? context.model,
      ...existing,
      routing: {
        capability: context.capability,
        strategy: context.strategy
      }
    }
  };
}

async function* attachRoutingToStream(
  stream: AsyncIterable<ProviderStreamEvent>,
  context: { provider: string; model: string; capability: string; strategy: RoutingStrategy }
): AsyncIterable<ProviderStreamEvent> {
  for await (const event of stream) {
    if (event.payload) {
      const enrichedPayload = attachRoutingMetadata(event.payload, context) as ProviderStreamEvent['payload'];
      yield {
        ...event,
        payload: enrichedPayload
      };
    } else {
      yield event;
    }
  }
}

function enrichModelMetadata(models: ModelDescriptor[], providerConfig: ProviderConfig): ModelDescriptor[] {
  const defaults = providerConfig.defaults ?? {};
  const defaultsByModel = new Map<string, string[]>();
  for (const [capability, modelId] of Object.entries(defaults)) {
    if (!defaultsByModel.has(modelId)) {
      defaultsByModel.set(modelId, []);
    }
    defaultsByModel.get(modelId)!.push(capability);
  }

  return models.map((model) => {
    const capabilityDefaults = defaultsByModel.get(model.id);
    return {
      ...model,
      ...(capabilityDefaults ? { defaults: capabilityDefaults } : {}),
      ...(providerConfig.scores ? { scores: providerConfig.scores } : {})
    };
  });
}

function buildCapabilityCoverage(
  providerConfig: ProviderConfig,
  baseStatus: ProviderHealthStatus
): Array<{ capability: string; status: ProviderHealthStatus }> {
  return providerConfig.capabilities.map((capability) => {
    return {
      capability,
      status: baseStatus
    };
  });
}

async function executeWithRetry<T extends { retryAfterMs?: number }>(
  operation: () => Promise<T>,
  providerKey: string,
  maxAttempts: number
): Promise<{ result: T; attempts: number }> {
  let attempt = 0;
  let lastProviderError: ProviderError | undefined;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await operation();
      return { result, attempts: attempt };
    } catch (error) {
      if (isProviderError(error)) {
        if (isRetryable(error.classification)) {
          lastProviderError = error;
          if (attempt < maxAttempts) {
            continue;
          }
          break;
        }
        throw error;
      }

      throw error;
    }
  }

  const message = `Provider ${providerKey} failed after ${maxAttempts} attempts`;
  throw new ProviderError(message, lastProviderError?.classification ?? 'TEMPORARY', {
    cause: lastProviderError
  });
}
