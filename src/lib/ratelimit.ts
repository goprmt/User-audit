/**
 * Simple sliding-window rate limiter.
 * In production, replace with Upstash Rate Limit or Redis.
 */

const store = new Map<string, number[]>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 5;

export function checkRateLimit(key: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const timestamps = (store.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS) {
    const oldest = timestamps[0];
    return { allowed: false, retryAfterMs: WINDOW_MS - (now - oldest) };
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return { allowed: true };
}
