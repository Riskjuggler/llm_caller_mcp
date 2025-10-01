import type {
  EmbedResponsePayload,
  ModelDescriptor,
  NormalizedChatRequest,
  NormalizedEmbedRequest,
  ProviderHealth,
  ProviderResponse,
  ProviderStreamEvent
} from '../orchestrator.js';
import type { ProviderConfig } from '../loadConfig.js';
import { ProviderError, isProviderError } from '../providerErrors.js';
import type { AdapterDependencies } from './types.js';
import type { HttpResponse } from './httpClient.js';
import { BaseProviderAdapter } from './baseAdapter.js';
import { createHttpError, joinUrl } from './helpers.js';
import {
  buildOpenAIRequestBody,
  normalizeOpenAIResponse,
  mapChatCompletionsStream,
  normalizeEmbeddingsResponse
} from './openaiAdapter.js';

export class LMStudioAdapter extends BaseProviderAdapter {
  constructor(
    providerConfig: ProviderConfig,
    private readonly deps: AdapterDependencies,
    adapterName: string = 'lmstudio'
  ) {
    super(adapterName, providerConfig);
  }

  async chat(request: NormalizedChatRequest): Promise<ProviderResponse<unknown>> {
    const url = joinUrl(this.providerConfig.baseUrl, 'chat/completions');
    const headers = {
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
      throw new ProviderError('LMStudio request failed', 'TEMPORARY', { cause: error });
    }

    if (httpResponse.status < 200 || httpResponse.status >= 300) {
      throw createHttpError('lmstudio', httpResponse.status, httpResponse.body);
    }

    return normalizeOpenAIResponse(httpResponse.body, this.name);
  }

  async *chatStream(request: NormalizedChatRequest): AsyncIterable<ProviderStreamEvent> {
    if (!this.deps.httpClient.postStream) {
      throw new ProviderError('HTTP client does not support streaming', 'CONFIG');
    }

    const url = joinUrl(this.providerConfig.baseUrl, 'chat/completions');
    const headers = {
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
      throw new ProviderError('LMStudio streaming request failed', 'TEMPORARY', { cause: error });
    }

    yield* mapChatCompletionsStream(stream, this.name, request.model);
  }

  async embed(request: NormalizedEmbedRequest): Promise<ProviderResponse<EmbedResponsePayload>> {
    const url = joinUrl(this.providerConfig.baseUrl, 'embeddings');
    const headers = {
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
      throw new ProviderError('LMStudio embeddings request failed', 'TEMPORARY', { cause: error });
    }

    if (httpResponse.status < 200 || httpResponse.status >= 300) {
      throw createHttpError('lmstudio', httpResponse.status, httpResponse.body);
    }

    return normalizeEmbeddingsResponse(httpResponse.body, request.requestId, this.name, request.model);
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const response = await this.fetchDiscovery();
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError(
        `LMStudio discovery request failed with status ${response.status}`,
        response.status >= 500 ? 'TEMPORARY' : 'CONFIG'
      );
    }

    return this.normalizeModelList(response.body);
  }

  async checkHealth(): Promise<ProviderHealth> {
    try {
      const models = await this.listModels();
      if (models.length === 0) {
        return { status: 'degraded', details: 'LMStudio reported zero models' };
      }
      return { status: 'ok' };
    } catch (error) {
      if (isProviderError(error)) {
        const status = error.classification === 'CONFIG' ? 'failed' : 'degraded';
        return { status, details: error.message };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'failed', details: message };
    }
  }

  private async fetchDiscovery(): Promise<HttpResponse<unknown>> {
    const url = joinUrl(this.providerConfig.baseUrl, 'models');
    try {
      return await this.deps.httpClient.get(url);
    } catch (error) {
      if (isProviderError(error)) {
        throw error;
      }
      throw new ProviderError('LMStudio discovery request failed', 'TEMPORARY', { cause: error });
    }
  }

  private normalizeModelList(payload: unknown): ModelDescriptor[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }
    const record = payload as Record<string, unknown>;
    const data = Array.isArray(record.data) ? record.data : [];
    const models: ModelDescriptor[] = [];

    for (const entry of data) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const modelRecord = entry as Record<string, unknown>;
      const id = typeof modelRecord.id === 'string' ? modelRecord.id : undefined;
      if (!id) {
        continue;
      }
      const ready = modelRecord.ready !== undefined ? Boolean(modelRecord.ready) : true;
      const description = typeof modelRecord.description === 'string' ? modelRecord.description : undefined;
      models.push({ id, ready, ...(description ? { description } : {}) });
    }

    return models;
  }
}
