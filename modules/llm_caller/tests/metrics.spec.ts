import { getMetricsSnapshot, recordRequest, resetMetrics } from '../src/metrics.js';

describe('metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('tracks totals, latency averages, provider mix, and retries', () => {
    recordRequest({ method: 'chat', outcome: 'success', durationMs: 50, provider: 'openai', retries: 0 });
    recordRequest({
      method: 'chat',
      outcome: 'error',
      durationMs: 150,
      provider: 'openai',
      retries: 2,
      classification: 'TEMPORARY'
    });
    recordRequest({ method: 'embed', outcome: 'success', durationMs: 100, provider: 'anthropic', retries: 1 });

    const snapshot = getMetricsSnapshot();

    expect(snapshot.requests.chat).toEqual({ total: 2, success: 1, error: 1 });
    expect(snapshot.requests.embed).toEqual({ total: 1, success: 1, error: 0 });
    expect(snapshot.latency.chat.averageMs).toBe(100);
    expect(snapshot.latency.chat.samples).toBe(2);
    expect(snapshot.latency.embed.averageMs).toBe(100);
    expect(snapshot.providers.openai).toEqual({ total: 2, success: 1, error: 1 });
    expect(snapshot.providers.anthropic).toEqual({ total: 1, success: 1, error: 0 });
    expect(snapshot.retries.chat).toEqual({ total: 2, average: 1 });
    expect(snapshot.retries.embed).toEqual({ total: 1, average: 1 });
    expect(snapshot.classifications.chat).toEqual({ TEMPORARY: 1 });
    expect(snapshot.classifications.embed).toEqual({});
  });

  it('resets counters', () => {
    recordRequest({ method: 'chatStream', outcome: 'success', durationMs: 10, retries: 0 });

    let snapshot = getMetricsSnapshot();
    expect(snapshot.requests.chatStream.total).toBe(1);

    resetMetrics();

    snapshot = getMetricsSnapshot();
    expect(snapshot.requests.chatStream.total).toBe(0);
    expect(snapshot.retries.chatStream.total).toBe(0);
    expect(snapshot.classifications.chatStream).toEqual({});
  });
});
