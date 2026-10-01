import { describe, expect, it, vi } from 'vitest';
import {
  buildSarvamKeyPool,
  classifySarvamStatus,
  decideNextAction,
  maskKey,
  parseRetryAfter,
  runWithKeyPool,
  type KeyPoolEntry,
} from '../src/services/sarvamKeys';

/**
 * These tests are entirely mocked: no network call is made and no real key is
 * used. Values below are obviously fake placeholders.
 */
const KEY_A = 'sarvam-fake-key-aaaaaaaa';
const KEY_B = 'sarvam-fake-key-bbbbbbbb';
const KEY_C = 'sarvam-fake-key-cccccccc';

describe('Sarvam key pool construction', () => {
  it('collects SARVAM_API_KEY_1..3 in order', () => {
    const pool = buildSarvamKeyPool({
      SARVAM_API_KEY_1: KEY_A,
      SARVAM_API_KEY_2: KEY_B,
      SARVAM_API_KEY_3: KEY_C,
    });
    expect(pool.map((entry) => entry.key)).toEqual([KEY_A, KEY_B, KEY_C]);
    expect(pool.map((entry) => entry.source)).toEqual(['SARVAM_API_KEY_1', 'SARVAM_API_KEY_2', 'SARVAM_API_KEY_3']);
    expect(pool.map((entry) => entry.index)).toEqual([1, 2, 3]);
  });

  it('keeps the legacy SARVAM_API_KEY for backward compatibility', () => {
    const pool = buildSarvamKeyPool({ SARVAM_API_KEY: KEY_A });
    expect(pool).toHaveLength(1);
    expect(pool[0].source).toBe('SARVAM_API_KEY');
  });

  it('ignores empty, whitespace and placeholder values', () => {
    const pool = buildSarvamKeyPool({
      SARVAM_API_KEY_1: '',
      SARVAM_API_KEY_2: '   ',
      SARVAM_API_KEY_3: KEY_C,
      SARVAM_API_KEY: 'your-sarvam-key-here',
    });
    expect(pool).toHaveLength(1);
    expect(pool[0].key).toBe(KEY_C);
  });

  it('collapses duplicates so the same key is never tried twice', () => {
    const pool = buildSarvamKeyPool({
      SARVAM_API_KEY_1: KEY_A,
      SARVAM_API_KEY_2: KEY_A,
      SARVAM_API_KEY_3: `  ${KEY_A}  `,
      SARVAM_API_KEY: KEY_B,
    });
    expect(pool).toHaveLength(2);
    expect(pool.map((entry) => entry.key)).toEqual([KEY_A, KEY_B]);
    // The duplicate is dropped, so indexes stay contiguous for diagnostics.
    expect(pool.map((entry) => entry.index)).toEqual([1, 2]);
  });

  it('returns an empty pool when nothing is configured', () => {
    expect(buildSarvamKeyPool({})).toEqual([]);
    expect(buildSarvamKeyPool({ SARVAM_API_KEY_1: undefined })).toEqual([]);
  });
});

describe('Sarvam secret redaction', () => {
  it('never returns a key in a form that can be reused', () => {
    const masked = maskKey(KEY_A);
    expect(masked).not.toContain(KEY_A);
    expect(masked).toContain('...');
    expect(masked.length).toBeLessThan(KEY_A.length);
  });

  it('fully hides short values and labels empty ones', () => {
    expect(maskKey('short')).toBe('***');
    expect(maskKey('')).toBe('[empty]');
  });

  it('does not put keys into key-pool diagnostics', () => {
    const pool = buildSarvamKeyPool({ SARVAM_API_KEY_1: KEY_A });
    const diagnostic = JSON.stringify(pool.map((entry) => ({ index: entry.index, source: entry.source })));
    expect(diagnostic).not.toContain(KEY_A);
  });
});

describe('Sarvam status classification', () => {
  it('treats 401 and 403 as key-specific authentication failures', () => {
    expect(classifySarvamStatus(401)).toBe('auth');
    expect(classifySarvamStatus(403)).toBe('auth');
  });

  it('treats 429 as a rate limit, not an auth failure', () => {
    expect(classifySarvamStatus(429)).toBe('rate_limit');
  });

  it('treats 5xx as transient and other 4xx as client errors', () => {
    expect(classifySarvamStatus(500)).toBe('transient');
    expect(classifySarvamStatus(503)).toBe('transient');
    expect(classifySarvamStatus(400)).toBe('client');
    expect(classifySarvamStatus(422)).toBe('client');
  });
});

describe('Retry-After parsing', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfter('2').waitMs).toBe(2000);
    expect(parseRetryAfter('0').waitMs).toBe(0);
  });

  it('caps an excessive delay so a request cannot hang', () => {
    expect(parseRetryAfter('600', 10_000).waitMs).toBe(10_000);
  });

  it('reads an HTTP-date', () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed.waitMs).not.toBeNull();
    expect(parsed.waitMs!).toBeGreaterThan(0);
    expect(parsed.waitMs!).toBeLessThanOrEqual(10_000);
  });

  it('treats a past HTTP-date as no wait', () => {
    const past = new Date(Date.now() - 5000).toUTCString();
    expect(parseRetryAfter(past).waitMs).toBe(0);
  });

  it('returns null when the header is absent or unparseable', () => {
    expect(parseRetryAfter(null).waitMs).toBeNull();
    expect(parseRetryAfter('').waitMs).toBeNull();
    expect(parseRetryAfter('soon').waitMs).toBeNull();
  });
});

describe('Sarvam failover policy', () => {
  const plan = { maxAttempts: 3, baseBackoffMs: 10, maxBackoffMs: 40 };

  it('moves to the next key only for an authentication failure', () => {
    const decision = decideNextAction({ failure: 'auth', attempt: 1, plan, hasNextKey: true, retryAfterMs: null });
    expect(decision.action).toBe('next_key');
  });

  it('fails when the last key is rejected', () => {
    const decision = decideNextAction({ failure: 'auth', attempt: 1, plan, hasNextKey: false, retryAfterMs: null });
    expect(decision.action).toBe('fail');
  });

  it('never rotates keys on 429 and instead waits for Retry-After', () => {
    const decision = decideNextAction({
      failure: 'rate_limit',
      attempt: 1,
      plan,
      hasNextKey: true,
      retryAfterMs: 1500,
    });
    expect(decision.action).toBe('wait_and_retry');
    expect(decision.action === 'wait_and_retry' && decision.delayMs).toBe(1500);
    // A rate limit must not consume the key pool.
    expect(decision.action).not.toBe('next_key');
  });

  it('falls back to backoff on 429 when Retry-After is missing', () => {
    const decision = decideNextAction({ failure: 'rate_limit', attempt: 2, plan, hasNextKey: true, retryAfterMs: null });
    expect(decision.action).toBe('wait_and_retry');
    expect(decision.action === 'wait_and_retry' && decision.delayMs).toBeGreaterThan(0);
  });

  it('backs off exponentially for transient failures and stays bounded', () => {
    const first = decideNextAction({ failure: 'transient', attempt: 1, plan, hasNextKey: true, retryAfterMs: null });
    const second = decideNextAction({ failure: 'transient', attempt: 2, plan, hasNextKey: true, retryAfterMs: null });
    expect(first).toEqual({ action: 'retry_same_key', delayMs: 10, reason: expect.any(String) });
    expect(second).toEqual({ action: 'retry_same_key', delayMs: 20, reason: expect.any(String) });
    expect(second.action === 'retry_same_key' && second.delayMs).toBeLessThanOrEqual(plan.maxBackoffMs);
  });

  it('gives up on a client error instead of replaying it', () => {
    const decision = decideNextAction({ failure: 'client', attempt: 1, plan, hasNextKey: true, retryAfterMs: null });
    expect(decision.action).toBe('fail');
  });

  it('stops once attempts are exhausted even with keys remaining', () => {
    const decision = decideNextAction({ failure: 'transient', attempt: 3, plan, hasNextKey: true, retryAfterMs: null });
    expect(decision.action).toBe('fail');
  });
});

describe('Sarvam pooled execution', () => {
  const entry = (key: string, index: number, source: string): KeyPoolEntry => ({ key, index, source });

  it('returns the first successful result without touching later keys', async () => {
    const perform = vi.fn(async (poolEntry: KeyPoolEntry) => ({ ok: true as const, value: poolEntry.key }));
    const result = await runWithKeyPool({
      pool: [entry(KEY_A, 1, 'SARVAM_API_KEY_1'), entry(KEY_B, 2, 'SARVAM_API_KEY_2')],
      perform,
      sleep: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.value).toBe(KEY_A);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('uses the second key after the first is rejected with 401', async () => {
    const seen: string[] = [];
    const result = await runWithKeyPool({
      pool: [entry(KEY_A, 1, 'SARVAM_API_KEY_1'), entry(KEY_B, 2, 'SARVAM_API_KEY_2')],
      perform: async (poolEntry) => {
        seen.push(poolEntry.key);
        return poolEntry.key === KEY_A
          ? { ok: false as const, status: 401, retryAfterMs: null }
          : { ok: true as const, value: 'transcribed' };
      },
      sleep: async () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('transcribed');
    expect(seen).toEqual([KEY_A, KEY_B]);
  });

  it('reports an auth failure when every key is rejected', async () => {
    const result = await runWithKeyPool({
      pool: [entry(KEY_A, 1, 'SARVAM_API_KEY_1'), entry(KEY_B, 2, 'SARVAM_API_KEY_2')],
      perform: async () => ({ ok: false as const, status: 403, retryAfterMs: null }),
      sleep: async () => undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('auth');
  });

  it('does not rotate keys on 429 and honours Retry-After', async () => {
    const used: string[] = [];
    const sleeps: number[] = [];
    const result = await runWithKeyPool({
      pool: [entry(KEY_A, 1, 'SARVAM_API_KEY_1'), entry(KEY_B, 2, 'SARVAM_API_KEY_2')],
      plan: { maxAttempts: 3, baseBackoffMs: 5, maxBackoffMs: 20 },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      perform: async (poolEntry) => {
        used.push(poolEntry.key);
        return used.length === 1
          ? { ok: false as const, status: 429, retryAfterMs: 1234 }
          : { ok: true as const, value: 'ok' };
      },
    });
    expect(result.ok).toBe(true);
    // Retry-After is respected exactly, and only the first key is ever used.
    expect(sleeps[0]).toBe(1234);
    expect(new Set(used)).toEqual(new Set([KEY_A]));
  });

  it('retries a transient failure with bounded attempts, then fails gracefully', async () => {
    const sleeps: number[] = [];
    const result = await runWithKeyPool({
      pool: [entry(KEY_A, 1, 'SARVAM_API_KEY_1')],
      plan: { maxAttempts: 3, baseBackoffMs: 5, maxBackoffMs: 20 },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      perform: async () => ({ ok: false as const, status: 503, retryAfterMs: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('transient');
    expect(sleeps).toHaveLength(2); // bounded: attempts - 1
    expect(sleeps.every((ms) => ms <= 20)).toBe(true);
  });

  it('returns a clear result when no key is configured', async () => {
    const result = await runWithKeyPool({ pool: [], perform: async () => ({ ok: true as const, value: 'x' }) });
    expect(result.ok).toBe(false);
    expect(result.notes.join(' ')).toContain('No Sarvam API key');
  });

  it('never puts a key value into diagnostics notes', async () => {
    const result = await runWithKeyPool({
      pool: [entry(KEY_A, 1, 'SARVAM_API_KEY_1')],
      perform: async () => ({ ok: false as const, status: 401, retryAfterMs: null }),
      sleep: async () => undefined,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(KEY_A);
    expect(serialized).toContain('SARVAM_API_KEY_1');
  });
});
