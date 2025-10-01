export type MetricMethod = 'chat' | 'chatStream' | 'embed';
export type MetricOutcome = 'success' | 'error';

interface LatencyStat {
  totalMs: number;
  count: number;
}

interface MethodStat {
  total: number;
  success: number;
  error: number;
}

interface RetryStat {
  total: number;
  count: number;
}

export interface MetricsSnapshot {
  requests: Record<MetricMethod, MethodStat>;
  latency: Record<MetricMethod, { averageMs: number; samples: number }>;
  providers: Record<string, { total: number; error: number; success: number }>;
  retries: Record<MetricMethod, { total: number; average: number }>;
  classifications: Record<MetricMethod, Record<string, number>>;
}

interface RecordParams {
  method: MetricMethod;
  outcome: MetricOutcome;
  durationMs: number;
  provider?: string;
  classification?: string;
  retries?: number;
}

const requestCounters: Record<MetricMethod, MethodStat> = {
  chat: { total: 0, success: 0, error: 0 },
  chatStream: { total: 0, success: 0, error: 0 },
  embed: { total: 0, success: 0, error: 0 }
};

const latencyTotals: Record<MetricMethod, LatencyStat> = {
  chat: { totalMs: 0, count: 0 },
  chatStream: { totalMs: 0, count: 0 },
  embed: { totalMs: 0, count: 0 }
};

const providerStats: Map<string, { total: number; success: number; error: number }> = new Map();
const retryTotals: Record<MetricMethod, RetryStat> = {
  chat: { total: 0, count: 0 },
  chatStream: { total: 0, count: 0 },
  embed: { total: 0, count: 0 }
};
const classificationTotals: Record<MetricMethod, Record<string, number>> = {
  chat: {},
  chatStream: {},
  embed: {}
};

export function recordRequest(params: RecordParams): void {
  const { method, outcome, durationMs, provider, retries, classification } = params;
  const methodCounter = requestCounters[method];
  methodCounter.total += 1;
  methodCounter[outcome] += 1;

  const latency = latencyTotals[method];
  if (Number.isFinite(durationMs) && durationMs >= 0) {
    latency.totalMs += durationMs;
    latency.count += 1;
  }

  if (retries !== undefined && Number.isFinite(retries) && retries >= 0) {
    retryTotals[method].total += Math.round(retries);
    retryTotals[method].count += 1;
  }

  if (provider) {
    const stat = providerStats.get(provider) ?? { total: 0, success: 0, error: 0 };
    stat.total += 1;
    stat[outcome] += 1;
    providerStats.set(provider, stat);
  }

  if (classification && typeof classification === 'string') {
    const bucket = classificationTotals[method];
    bucket[classification] = (bucket[classification] ?? 0) + 1;
  }
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const snapshotRequests: MetricsSnapshot['requests'] = {
    chat: { ...requestCounters.chat },
    chatStream: { ...requestCounters.chatStream },
    embed: { ...requestCounters.embed }
  };

  const snapshotLatency: MetricsSnapshot['latency'] = {
    chat: createLatency(latencyTotals.chat),
    chatStream: createLatency(latencyTotals.chatStream),
    embed: createLatency(latencyTotals.embed)
  };

  const providers: MetricsSnapshot['providers'] = {};
  for (const [provider, stat] of providerStats.entries()) {
    providers[provider] = { ...stat };
  }

  const retries: MetricsSnapshot['retries'] = {
    chat: createRetryStat(retryTotals.chat),
    chatStream: createRetryStat(retryTotals.chatStream),
    embed: createRetryStat(retryTotals.embed)
  };

  const classifications: MetricsSnapshot['classifications'] = {
    chat: { ...classificationTotals.chat },
    chatStream: { ...classificationTotals.chatStream },
    embed: { ...classificationTotals.embed }
  };

  return {
    requests: snapshotRequests,
    latency: snapshotLatency,
    providers,
    retries,
    classifications
  };
}

export function resetMetrics(): void {
  for (const method of Object.keys(requestCounters) as MetricMethod[]) {
    requestCounters[method] = { total: 0, success: 0, error: 0 };
    latencyTotals[method] = { totalMs: 0, count: 0 };
    retryTotals[method] = { total: 0, count: 0 };
    classificationTotals[method] = {};
  }
  providerStats.clear();
}

function createLatency(stat: LatencyStat): { averageMs: number; samples: number } {
  if (stat.count === 0) {
    return { averageMs: 0, samples: 0 };
  }
  return {
    averageMs: stat.totalMs / stat.count,
    samples: stat.count
  };
}

function createRetryStat(stat: RetryStat): { total: number; average: number } {
  if (stat.count === 0) {
    return { total: 0, average: 0 };
  }
  return {
    total: stat.total,
    average: stat.total / stat.count
  };
}
