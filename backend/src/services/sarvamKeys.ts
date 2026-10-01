/**
 * Sarvam API key pool.
 *
 * Rules implemented here:
 *  - Keys come from SARVAM_API_KEY_1..3 (backend-only) plus the legacy
 *    SARVAM_API_KEY, which is kept for backward compatibility.
 *  - Empty values are ignored, and duplicates are collapsed so a repeated key
 *    is never tried twice.
 *  - A key is only skipped when the provider rejects *that key* (401/403).
 *    429 is never used to rotate keys: a rate limit belongs to the account, so
 *    rotating would be circumventing the provider's quota.
 *  - Keys are never logged, never returned to clients, and never included in
 *    error messages.
 */

export const MAX_SARVAM_KEYS = 3;

export interface KeyPoolEntry {
  /** 1-based position, safe to log. */
  index: number;
  /** Environment variable the key came from, safe to log. */
  source: string;
  key: string;
}

function looksLikePlaceholder(value: string): boolean {
  const lowered = value.toLowerCase();
  return (
    lowered === '' ||
    lowered === 'undefined' ||
    lowered === 'null' ||
    lowered.includes('your-') ||
    lowered.includes('changeme') ||
    lowered.includes('placeholder') ||
    lowered.includes('xxxx')
  );
}

/**
 * Builds the ordered, de-duplicated key pool from the environment.
 * `env` is injected so tests never touch the real process environment.
 */
export function buildSarvamKeyPool(env: Record<string, string | undefined>): KeyPoolEntry[] {
  const sources = [
    ...Array.from({ length: MAX_SARVAM_KEYS }, (_, i) => `SARVAM_API_KEY_${i + 1}`),
    'SARVAM_API_KEY',
  ];

  const seen = new Set<string>();
  const pool: KeyPoolEntry[] = [];

  for (const source of sources) {
    const raw = env[source];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value || looksLikePlaceholder(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    pool.push({ index: pool.length + 1, source, key: value });
  }

  return pool;
}

/** Masks a key for diagnostics: never reveals enough to reuse. */
export function maskKey(key: string): string {
  if (!key) return '[empty]';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-2)} (len=${key.length})`;
}

export type FailureKind = 'auth' | 'rate_limit' | 'transient' | 'client';

/**
 * Classifies a provider response so the caller can decide between trying the
 * next key, honouring Retry-After, or giving up.
 */
export function classifySarvamStatus(status: number): FailureKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'transient';
  return 'client';
}

export interface RetryAfter {
  /** Milliseconds to wait, or null when the header was absent/unparseable. */
  waitMs: number | null;
  raw: string | null;
}

/**
 * Reads Retry-After in both supported forms: delay-seconds and HTTP-date.
 * The wait is capped so a request cannot hang indefinitely.
 */
export function parseRetryAfter(headerValue: string | null | undefined, maxMs = 10_000): RetryAfter {
  if (!headerValue) return { waitMs: null, raw: null };
  const trimmed = headerValue.trim();
  if (!trimmed) return { waitMs: null, raw: null };

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return { waitMs: Math.min(seconds * 1000, maxMs), raw: trimmed };
  }

  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now();
    if (delta <= 0) return { waitMs: 0, raw: trimmed };
    return { waitMs: Math.min(delta, maxMs), raw: trimmed };
  }

  return { waitMs: null, raw: trimmed };
}

export interface AttemptPlan {
  /** Total provider attempts allowed for one logical request. */
  maxAttempts: number;
  /** Base backoff for transient failures, in milliseconds. */
  baseBackoffMs: number;
  /** Upper bound for a single backoff sleep. */
  maxBackoffMs: number;
}

export const DEFAULT_ATTEMPT_PLAN: AttemptPlan = {
  maxAttempts: 3,
  baseBackoffMs: 400,
  maxBackoffMs: 4000,
};

/**
 * Decides what to do after a failed attempt. Kept pure so it is easy to test.
 */
export type NextAction =
  | { action: 'next_key'; reason: string }
  | { action: 'retry_same_key'; delayMs: number; reason: string }
  | { action: 'wait_and_retry'; delayMs: number; reason: string }
  | { action: 'fail'; reason: string };

export function decideNextAction(input: {
  failure: FailureKind;
  attempt: number;
  plan: AttemptPlan;
  hasNextKey: boolean;
  retryAfterMs: number | null;
}): NextAction {
  const { failure, attempt, plan, hasNextKey, retryAfterMs } = input;
  const attemptsLeft = attempt < plan.maxAttempts;

  if (failure === 'auth') {
    // Only a key-specific rejection justifies trying another key.
    if (hasNextKey && attemptsLeft) {
      return { action: 'next_key', reason: 'The provider rejected this API key.' };
    }
    return { action: 'fail', reason: 'The provider rejected the configured API key(s).' };
  }

  if (failure === 'rate_limit') {
    // Never rotate keys for a rate limit: the quota belongs to the account.
    if (!attemptsLeft) {
      return { action: 'fail', reason: 'The speech service is rate limited right now.' };
    }
    const delay = retryAfterMs ?? Math.min(plan.baseBackoffMs * 2 ** (attempt - 1), plan.maxBackoffMs);
    return { action: 'wait_and_retry', delayMs: delay, reason: 'The speech service asked us to slow down.' };
  }

  if (failure === 'transient') {
    if (!attemptsLeft) {
      return { action: 'fail', reason: 'The speech service is not responding right now.' };
    }
    const delay = Math.min(plan.baseBackoffMs * 2 ** (attempt - 1), plan.maxBackoffMs);
    return { action: 'retry_same_key', delayMs: delay, reason: 'The speech service returned a server error.' };
  }

  // 4xx other than auth/rate limit: the request itself is wrong, so retrying
  // the same payload (possibly on another key) cannot help.
  return { action: 'fail', reason: 'The speech request was rejected by the provider.' };
}

export interface AttemptResult<T> {
  ok: boolean;
  value?: T;
  status?: number;
  failure?: FailureKind;
  retryAfterMs?: number | null;
  keyIndex?: number;
  keySource?: string;
  /** Safe, redacted diagnostics for logs. */
  notes: string[];
}

/**
 * Runs one logical provider call across the key pool with bounded attempts.
 * `perform` receives a key entry and must not log the key itself.
 */
export async function runWithKeyPool<T>(input: {
  pool: KeyPoolEntry[];
  plan?: AttemptPlan;
  sleep?: (ms: number) => Promise<void>;
  perform: (entry: KeyPoolEntry, attempt: number) => Promise<{ ok: true; value: T } | { ok: false; status: number; retryAfterMs?: number | null }>;
}): Promise<AttemptResult<T>> {
  const plan = input.plan ?? DEFAULT_ATTEMPT_PLAN;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const notes: string[] = [];

  if (input.pool.length === 0) {
    return { ok: false, notes: ['No Sarvam API key is configured.'] };
  }

  let keyPosition = 0;
  let attempt = 0;
  let lastFailure: FailureKind | undefined;
  let lastStatus: number | undefined;

  while (attempt < plan.maxAttempts && keyPosition < input.pool.length) {
    attempt += 1;
    const entry = input.pool[keyPosition];
    const result = await input.perform(entry, attempt);

    if (result.ok) {
      return { ok: true, value: result.value, keyIndex: entry.index, keySource: entry.source, notes };
    }

    const failure = classifySarvamStatus(result.status);
    lastFailure = failure;
    lastStatus = result.status;
    notes.push(
      `attempt ${attempt} using ${entry.source} (key #${entry.index}) failed with status ${result.status} -> ${failure}`,
    );

    const hasNextKey = keyPosition < input.pool.length - 1;
    const decision = decideNextAction({
      failure,
      attempt,
      plan,
      hasNextKey,
      retryAfterMs: result.retryAfterMs ?? null,
    });

    if (decision.action === 'fail') {
      return {
        ok: false,
        status: lastStatus,
        failure: lastFailure,
        keyIndex: entry.index,
        keySource: entry.source,
        notes: [...notes, decision.reason],
      };
    }

    if (decision.action === 'next_key') {
      keyPosition += 1;
      notes.push(decision.reason);
      continue;
    }

    // retry_same_key and wait_and_retry both sleep, then retry the same key.
    notes.push(`${decision.reason} waiting ${decision.delayMs}ms`);
    await sleep(decision.delayMs);
  }

  notes.push('Exhausted the allowed attempts.');
  return { ok: false, status: lastStatus, failure: lastFailure, notes };
}
