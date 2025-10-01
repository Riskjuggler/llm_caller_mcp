import type {
  EmbedResponsePayload,
  NormalizedChatRequest,
  NormalizedEmbedRequest,
  ProviderResponse,
  ProviderStreamEvent
} from '../orchestrator.js';
import type { ProviderConfig } from '../loadConfig.js';
import { ProviderError, isProviderError } from '../providerErrors.js';
import type { AdapterDependencies } from './types.js';
import { BaseProviderAdapter } from './baseAdapter.js';
import { createHttpError, joinUrl } from './helpers.js';

export class OpenAIAdapter extends BaseProviderAdapter {
  constructor(providerConfig: ProviderConfig, private readonly deps: AdapterDependencies) {
    super('openai', providerConfig);
  }

  async chat(request: NormalizedChatRequest): Promise<ProviderResponse<unknown>> {
    const apiKey = await this.deps.secretsProvider.getSecret('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ProviderError('OpenAI API key not configured', 'CONFIG');
    }

    const url = joinUrl(this.providerConfig.baseUrl, 'chat/completions');
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    const body = buildOpenAIRequestBody(request);

    let httpResponse;
    try {
      httpResponse = await this.deps.httpClient.post(url, { headers, body });
    } catch (error) {
      if (isProviderError(error)) {
        throw error;
      }
      throw new ProviderError('OpenAI request failed', 'TEMPORARY', { cause: error });
    }

    if (httpResponse.status < 200 || httpResponse.status >= 300) {
      throw createHttpError('openai', httpResponse.status, httpResponse.body);
    }

    return normalizeOpenAIResponse(httpResponse.body, this.name);
  }

  async *chatStream(request: NormalizedChatRequest): AsyncIterable<ProviderStreamEvent> {
    const apiKey = await this.deps.secretsProvider.getSecret('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ProviderError('OpenAI API key not configured', 'CONFIG');
    }

    if (!this.deps.httpClient.postStream) {
      throw new ProviderError('HTTP client does not support streaming', 'CONFIG');
    }

    const url = joinUrl(this.providerConfig.baseUrl, 'chat/completions');
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    const body = { ...buildOpenAIRequestBody(request), stream: true };

    let stream: AsyncIterable<string>;
    try {
      stream = this.deps.httpClient.postStream(url, { headers, body }) as AsyncIterable<string>;
    } catch (error) {
      if (isProviderError(error)) {
        throw error;
      }
      throw new ProviderError('OpenAI streaming request failed', 'TEMPORARY', { cause: error });
    }

    yield* mapChatCompletionsStream(stream, this.name, request.model);
  }

  async embed(request: NormalizedEmbedRequest): Promise<ProviderResponse<EmbedResponsePayload>> {
    const apiKey = await this.deps.secretsProvider.getSecret('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ProviderError('OpenAI API key not configured', 'CONFIG');
    }

    const url = joinUrl(this.providerConfig.baseUrl, 'embeddings');
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    const body = {
      model: request.model,
      input: request.inputs
    };

    let httpResponse;
    try {
      httpResponse = await this.deps.httpClient.post(url, { headers, body });
    } catch (error) {
      if (isProviderError(error)) {
        throw error;
      }
      throw new ProviderError('OpenAI embeddings request failed', 'TEMPORARY', { cause: error });
    }

    if (httpResponse.status < 200 || httpResponse.status >= 300) {
      throw createHttpError('openai', httpResponse.status, httpResponse.body);
    }

    return normalizeEmbeddingsResponse(httpResponse.body, request.requestId, this.name, request.model);
  }
}

export function buildOpenAIRequestBody(request: NormalizedChatRequest): Record<string, unknown> {
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

export function normalizeOpenAIResponse(responseBody: unknown, providerName: string): ProviderResponse<unknown> {
  if (!responseBody || typeof responseBody !== 'object') {
    throw new ProviderError('OpenAI response missing payload', 'TEMPORARY');
  }

  const body = responseBody as Record<string, any>;
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const firstChoice = choices[0];
  const message = firstChoice?.message;

  if (!message) {
    throw new ProviderError('OpenAI response missing completion message', 'TEMPORARY');
  }

  const usage = normalizeChatUsage(body.usage);

  return {
    payload: {
      message,
      usage,
      providerInfo: {
        name: providerName,
        model: body.model
      }
    },
    traceId: typeof body.id === 'string' ? body.id : ''
  };
}

export function normalizeEmbeddingsResponse(
  body: unknown,
  traceId: string,
  providerName: string,
  model?: string
): ProviderResponse<EmbedResponsePayload> {
  if (!body || typeof body !== 'object') {
    throw new ProviderError('OpenAI embeddings response malformed', 'TEMPORARY');
  }

  const record = body as Record<string, any>;
  const data = Array.isArray(record.data) ? record.data : [];
  const embeddings = data.map((entry) => {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.embedding)) {
      throw new ProviderError('OpenAI embeddings response missing embedding vector', 'TEMPORARY');
    }
    return entry.embedding as number[];
  });

  return {
    payload: {
      vectors: embeddings,
      usage: normalizeEmbeddingUsage(record.usage),
      providerInfo: { name: providerName, model }
    },
    traceId
  };
}

export async function* mapChatCompletionsStream(
  source: AsyncIterable<string>,
  providerName: string,
  model?: string
): AsyncIterable<ProviderStreamEvent> {
  let accumulatedContent = '';
  let role: string | undefined;
  let traceId: string | undefined;
  let usageRaw: unknown;

  for await (const chunk of source) {
    const data = extractDataPayload(chunk);
    if (!data) {
      continue;
    }
    if (data === '[DONE]') {
      break;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      throw new ProviderError('Failed to parse OpenAI stream payload', 'TEMPORARY', { cause: error });
    }

    if (typeof parsed.id === 'string') {
      traceId = parsed.id;
    }

    if (parsed.usage) {
      usageRaw = parsed.usage;
    }

    const choices: any[] = Array.isArray(parsed.choices) ? parsed.choices : [];
    for (const choice of choices) {
      if (choice.delta) {
        const delta = choice.delta as Record<string, unknown>;
        const deltaEvent: ProviderStreamEvent = {
          type: 'delta',
          delta: {},
          traceId
        };

        if (typeof delta.role === 'string') {
          role = delta.role;
          deltaEvent.delta!.role = delta.role;
        }

        if (typeof delta.content === 'string') {
          accumulatedContent += delta.content;
          deltaEvent.delta!.content = delta.content;
        }

        if (deltaEvent.delta && (deltaEvent.delta.role || deltaEvent.delta.content)) {
          yield deltaEvent;
        }
      }

      if (choice.finish_reason === 'stop') {
        yield {
          type: 'completion',
          payload: {
            message: {
              role: role ?? 'assistant',
              content: accumulatedContent
            },
            usage: normalizeChatUsage(usageRaw),
            providerInfo: {
              name: providerName,
              model
            }
          },
          traceId
        };
      }
    }
  }
}

export function extractDataPayload(chunk: string): string | undefined {
  if (typeof chunk !== 'string') {
    return undefined;
  }
  const lines = chunk.split('\n');
  const dataLines = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return undefined;
  }
  return dataLines.join('\n').trim();
}

function normalizeChatUsage(raw: unknown): { inputTokens: number; outputTokens: number; totalTokens?: number } {
  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const input = toNumber(base['prompt_tokens']) ?? toNumber(base['input_tokens']) ?? 0;
  const output = toNumber(base['completion_tokens']) ?? toNumber(base['output_tokens']) ?? 0;
  const total = toNumber(base['total_tokens']);
  const usage: { inputTokens: number; outputTokens: number; totalTokens?: number } = {
    inputTokens: clampNonNegative(input),
    outputTokens: clampNonNegative(output)
  };
  const derivedTotal = total ?? (Number.isFinite(input) && Number.isFinite(output) ? input + output : undefined);
  if (derivedTotal !== undefined) {
    usage.totalTokens = clampNonNegative(derivedTotal);
  }
  return usage;
}

function normalizeEmbeddingUsage(raw: unknown): { inputTokens: number; outputTokens?: number; totalTokens?: number } {
  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const input = toNumber(base['prompt_tokens']) ?? toNumber(base['input_tokens']) ?? 0;
  const output = toNumber(base['completion_tokens']) ?? toNumber(base['output_tokens']);
  const total = toNumber(base['total_tokens']);
  const usage: { inputTokens: number; outputTokens?: number; totalTokens?: number } = {
    inputTokens: clampNonNegative(input)
  };
  if (output !== undefined) {
    usage.outputTokens = clampNonNegative(output);
  }
  const derivedTotal = total ?? (output !== undefined ? input + output : undefined);
  if (derivedTotal !== undefined) {
    usage.totalTokens = clampNonNegative(derivedTotal);
  }
  return usage;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value <= 0 ? 0 : Math.round(value);
}
