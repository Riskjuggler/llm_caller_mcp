import { FetchHttpClient } from '../adapters/fetchHttpClient.js';

export interface LMStudioModelDescriptor {
  id: string;
  ready: boolean;
  description?: string;
}

const client = new FetchHttpClient();

export async function fetchLMStudioModels(baseUrl: string): Promise<LMStudioModelDescriptor[]> {
  const url = new URL('models', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const response = await client.get<{ data?: Array<Record<string, unknown>> }>(url.toString(), {
    timeoutMs: 5000
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`LM Studio responded with status ${response.status}`);
  }

  const data = Array.isArray(response.body?.data) ? response.body?.data : [];

  return data
    .map((raw) => normalizeEntry(raw))
    .filter((entry): entry is LMStudioModelDescriptor => Boolean(entry));
}

function normalizeEntry(entry: Record<string, unknown> | undefined): LMStudioModelDescriptor | undefined {
  if (!entry) {
    return undefined;
  }
  const id = typeof entry.id === 'string' ? entry.id : undefined;
  if (!id) {
    return undefined;
  }
  const ready = entry.ready !== undefined ? Boolean(entry.ready) : true;
  const description = typeof entry.description === 'string' ? entry.description : undefined;
  return { id, ready, ...(description ? { description } : {}) };
}
