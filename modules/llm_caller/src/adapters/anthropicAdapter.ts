import type { NormalizedChatRequest, ProviderResponse } from '../orchestrator.js';
import type { ProviderConfig } from '../loadConfig.js';
import { ProviderError, isProviderError } from '../providerErrors.js';
import type { AdapterDependencies } from './types.js';
import { BaseProviderAdapter } from './baseAdapter.js';
import { createHttpError, joinUrl } from './helpers.js';

export class AnthropicAdapter extends BaseProviderAdapter {
  constructor(providerConfig: ProviderConfig, private readonly deps: AdapterDependencies) {
    super('anthropic', providerConfig);
  }

  async chat(request: NormalizedChatRequest): Promise<ProviderResponse<unknown>> {
    const apiKey = await this.deps.secretsProvider.getSecret('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new ProviderError('Anthropic API key not configured', 'CONFIG');
    }

    const url = joinUrl(this.providerConfig.baseUrl, 'messages');
    const headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    };
    const body = buildAnthropicRequestBody(request);

    let httpResponse;
    try {
      httpResponse = await this.deps.httpClient.post(url, { headers, body });
    } catch (error) {
      if (isProviderError(error)) {
        throw error;
      }
      throw new ProviderError('Anthropic request failed', 'TEMPORARY', { cause: error });
    }

    if (httpResponse.status < 200 || httpResponse.status >= 300) {
      throw createHttpError('anthropic', httpResponse.status, httpResponse.body);
    }

    return normalizeAnthropicResponse(httpResponse.body, this.name);
  }
}

function buildAnthropicRequestBody(request: NormalizedChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages
  };

  if (typeof request.temperature === 'number') {
    body.temperature = request.temperature;
  }
  if (typeof request.maxTokens === 'number') {
    body.max_tokens = request.maxTokens;
  }

  return body;
}

function normalizeAnthropicResponse(responseBody: unknown, providerName: string): ProviderResponse<unknown> {
  if (!responseBody || typeof responseBody !== 'object') {
    throw new ProviderError('Anthropic response missing payload', 'TEMPORARY');
  }

  const body = responseBody as Record<string, any>;
  const content = Array.isArray(body.content) ? body.content : [];
  const firstTextBlock = content.find((entry) => entry?.type === 'text');
  const text = firstTextBlock?.text;

  if (typeof text !== 'string') {
    throw new ProviderError('Anthropic response missing completion text', 'TEMPORARY');
  }

  return {
    payload: {
      message: { role: 'assistant', content: text },
      usage: normalizeAnthropicUsage(body.usage),
      providerInfo: {
        name: providerName,
        model: body.model
      }
    },
    traceId: typeof body.id === 'string' ? body.id : ''
  };
}

function normalizeAnthropicUsage(raw: unknown): { inputTokens: number; outputTokens: number; totalTokens?: number } {
  const base = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const input = toNumber(base['input_tokens']) ?? 0;
  const output = toNumber(base['output_tokens']) ?? 0;
  const total = toNumber(base['total_tokens']);

  const usage: { inputTokens: number; outputTokens: number; totalTokens?: number } = {
    inputTokens: clampNonNegative(input),
    outputTokens: clampNonNegative(output)
  };

  if (total !== undefined) {
    usage.totalTokens = clampNonNegative(total);
  }

  return usage;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value);
}
