import { AppError, notConfigured } from '../lib/errors';
import { logger } from '../lib/logger';
import type { LanguageCode } from './prompt';
import {
  buildSarvamKeyPool,
  maskKey,
  parseRetryAfter,
  runWithKeyPool,
  type KeyPoolEntry,
  type AttemptPlan,
} from './sarvamKeys';

/**
 * Sarvam AI speech (STT + TTS).
 *
 * VERIFIED AGAINST THE LIVE API AND THE OFFICIAL DOCS.
 *
 * Speech to text (docs.sarvam.ai, "Speech-to-Text Rest API"):
 *   - The `mode` parameter is supported on POST /speech-to-text by saaras:v3
 *     and saaras:v4. Documented modes are: transcribe, translate, verbatim,
 *     translit, codemix.
 *   - saaras:v4 is the documented default and recommended model.
 *   - We send mode=transcribe, which returns the transcript in the language
 *     that was SPOKEN (native script). It does NOT translate to English. The
 *     translate mode exists but is deliberately not used here.
 *   - language_code=unknown requests automatic detection. Verified live: the
 *     response returns the detected code, e.g. "bn-IN", "hi-IN", "en-IN".
 *   - saaras:v3 additionally returns language_probability; v4 does not. Both
 *     fields are captured when present.
 *   - /speech-to-text-translate is the legacy endpoint and is not used.
 *
 * Text to speech:
 *   - 'bulbul:v2' is REJECTED with HTTP 400: "Model 'bulbul:v2' has been
 *     deprecated. Please use 'bulbul:v3' instead." The default is v3.
 *   - The speaker must belong to the selected model. 'anushka' is not in the
 *     bulbul:v3 speaker list, so the default is 'ritu'.
 *
 * Everything remains configurable without a code change:
 *   SARVAM_BASE_URL, SARVAM_STT_PATH, SARVAM_TTS_PATH, SARVAM_STT_MODE,
 *   SARVAM_STT_MODEL, SARVAM_TTS_MODEL, SARVAM_TTS_SPEAKER
 */
export const SARVAM_BASE_URL = 'https://api.sarvam.ai';
export const SARVAM_STT_PATH = '/speech-to-text';
export const SARVAM_TTS_PATH = '/text-to-speech';

/**
 * Documented Sarvam STT output modes. Only `transcribe` returns the customer's
 * own words in their own language; the others translate, transliterate or
 * preserve disfluencies, which is not what this app wants.
 */
export const SARVAM_STT_MODES = ['transcribe', 'translate', 'verbatim', 'translit', 'codemix'] as const;
export type SarvamSttMode = (typeof SARVAM_STT_MODES)[number];

/**
 * Native-language transcription. Never change this to `translate`: that would
 * return English text for Bengali or Hindi speech and break the whole
 * reply-language pipeline.
 */
export const SARVAM_STT_MODE: SarvamSttMode = 'transcribe';

export function isSarvamSttMode(value: unknown): value is SarvamSttMode {
  return typeof value === 'string' && (SARVAM_STT_MODES as readonly string[]).includes(value);
}

/**
 * Maps Sarvam's returned locale back onto the app's LanguageCode.
 *
 * Sarvam answers with codes like "bn-IN", "hi-IN", "en-IN" and sometimes a
 * bare "bn"/"hi"/"en". Anything we do not recognise returns null so the caller
 * can fall back to the customer's selected language instead of guessing.
 */
export function normalizeSarvamLanguage(value: string | null | undefined): LanguageCode | null {
  if (!value) return null;
  const lower = String(value).trim().toLowerCase();
  const base = lower.split(/[-_]/)[0];
  if (base === 'en' || base === 'bn' || base === 'hi') return base;
  // Sarvam can answer with a name rather than a code.
  if (lower.startsWith('bengali')) return 'bn';
  if (lower.startsWith('hindi')) return 'hi';
  if (lower.startsWith('english')) return 'en';
  return null;
}

/** en-IN, bn-IN or hi-IN when the customer picked a language, else "unknown". */
export function sarvamLanguageCode(language: LanguageCode | null | undefined): string {
  switch (language) {
    case 'en':
      return 'en-IN';
    case 'bn':
      return 'bn-IN';
    case 'hi':
      return 'hi-IN';
    default:
      return 'unknown';
  }
}

export interface TranscriptionResult {
  transcript: string;
  /** Raw locale as returned by the provider, e.g. "bn-IN". */
  languageCode: string | null;
  /** Provider confidence when it reports one (saaras:v3); null otherwise. */
  languageProbability: number | null;
  /** The mode that produced this transcript. */
  mode: SarvamSttMode;
}

export interface SynthesisResult {
  audioBase64: string;
  mimeType: string;
}

export interface SpeechClient {
  transcribe(audio: Buffer, options: { filename: string; mimetype: string; languageCode: string }): Promise<TranscriptionResult>;
  synthesize(text: string, options: { languageCode: string }): Promise<SynthesisResult>;
}

export interface SarvamConfig {
  /** Ordered key pool. Built by buildSarvamKeyPool() from the environment. */
  keyPool: KeyPoolEntry[];
  sttModel: string;
  /** STT output mode. Must stay `transcribe` for native-language output. */
  sttMode: SarvamSttMode;
  ttsModel: string;
  ttsSpeaker: string;
  baseUrl?: string;
  sttPath?: string;
  ttsPath?: string;
  timeoutMs?: number;
  attemptPlan?: AttemptPlan;
  /** Injected in tests so backoff does not slow the suite down. */
  sleep?: (ms: number) => Promise<void>;
}

/** Builds a config from process.env, de-duplicating and ignoring blank keys. */
export function sarvamConfigFromEnv(env: Record<string, string | undefined>): SarvamConfig {
  const requestedMode = (env.SARVAM_STT_MODE || '').trim();
  return {
    keyPool: buildSarvamKeyPool(env),
    // saaras:v4 is the documented default and recommended model, and it
    // supports the `mode` parameter.
    sttModel: (env.SARVAM_STT_MODEL || 'saaras:v4').trim(),
    // Refuse a non-transcribe mode: translation would return English for
    // Bengali/Hindi speech and silently break the reply language.
    sttMode: isSarvamSttMode(requestedMode) && requestedMode === 'transcribe' ? requestedMode : SARVAM_STT_MODE,
    ttsModel: (env.SARVAM_TTS_MODEL || 'bulbul:v3').trim(),
    ttsSpeaker: (env.SARVAM_TTS_SPEAKER || 'ritu').trim(),
    baseUrl: (env.SARVAM_BASE_URL || SARVAM_BASE_URL).trim(),
    sttPath: (env.SARVAM_STT_PATH || SARVAM_STT_PATH).trim(),
    ttsPath: (env.SARVAM_TTS_PATH || SARVAM_TTS_PATH).trim(),
    timeoutMs: Number(env.SARVAM_TIMEOUT_MS ?? 30000) || 30000,
  };
}

export function createSarvamClient(
  config: SarvamConfig,
  fetchImpl: typeof fetch = fetch,
): SpeechClient {
  const baseUrl = (config.baseUrl ?? SARVAM_BASE_URL).replace(/\/$/, '');
  const sttPath = config.sttPath ?? SARVAM_STT_PATH;
  const ttsPath = config.ttsPath ?? SARVAM_TTS_PATH;
  const timeoutMs = config.timeoutMs ?? 30000;

  function assertConfigured(): void {
    if (config.keyPool.length === 0) {
      throw notConfigured(
        'Voice input and playback are not configured on the server yet. Please type your question instead.',
        {
          missing: ['SARVAM_API_KEY_1 (or SARVAM_API_KEY)'],
          setup: 'Set one or more Sarvam API keys in the backend environment (see docs/DEPLOYMENT.md).',
        },
      );
    }
  }

  /** Single attempt against one key. Never logs or returns the key itself. */
  async function attempt(
    entry: KeyPoolEntry,
    path: string,
    build: () => { body: FormData | string; headers?: Record<string, string> },
  ): Promise<{ ok: true; response: Response } | { ok: false; status: number; retryAfterMs: number | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { body, headers } = build();
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { ...(headers ?? {}), 'api-subscription-key': entry.key },
        body,
        signal: controller.signal,
      });

      if (response.ok) return { ok: true, response };

      const retryAfter = parseRetryAfter(response.headers?.get?.('retry-after') ?? null);
      // Drain the body so the socket is released, but never surface it: it can
      // echo request content.
      await response.text().catch(() => '');
      return { ok: false, status: response.status, retryAfterMs: retryAfter.waitMs };
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      logger.warn('sarvam request failed', {
        path,
        reason: aborted ? 'timeout' : (error as Error).name,
      });
      // A network/timeout problem is transient: report 503 so the pool retries.
      return { ok: false, status: 503, retryAfterMs: null };
    } finally {
      clearTimeout(timer);
    }
  }

  function unavailable(reason: string): AppError {
    return new AppError(
      503,
      'SPEECH_UNAVAILABLE',
      'The speech service is unavailable right now. Please type your question - the written answer still works.',
      { reason },
    );
  }

  return {
    async transcribe(audio, options) {
      assertConfigured();

      const result = await runWithKeyPool<TranscriptionResult>({
        pool: config.keyPool,
        plan: config.attemptPlan,
        sleep: config.sleep,
        perform: async (entry) => {
          const form = new FormData();
          form.append('file', new Blob([new Uint8Array(audio)], { type: options.mimetype }), options.filename);
          form.append('model', config.sttModel);
          form.append('language_code', options.languageCode);
          // Native-language transcription. `translate` would return English.
          form.append('mode', config.sttMode);

          const outcome = await attempt(entry, sttPath, () => ({ body: form }));
          if (!outcome.ok) {
            if (outcome.status === 401 || outcome.status === 403) {
              logger.warn('sarvam rejected a key', {
                source: entry.source,
                keyIndex: entry.index,
                key: maskKey(entry.key),
              });
            }
            return { ok: false as const, status: outcome.status, retryAfterMs: outcome.retryAfterMs };
          }

          const payload = (await outcome.response.json()) as {
            transcript?: string;
            language_code?: string | null;
            language_probability?: number | null;
          };
          return {
            ok: true as const,
            value: {
              transcript: String(payload.transcript ?? '').trim(),
              languageCode: payload.language_code ?? null,
              languageProbability:
                typeof payload.language_probability === 'number' ? payload.language_probability : null,
              mode: config.sttMode,
            },
          };
        },
      });

      if (!result.ok || !result.value) {
        if (result.failure === 'auth') {
          throw notConfigured(
            'Sarvam rejected the configured API key, so voice input is unavailable. Please type your question.',
            { missing: ['SARVAM_API_KEY_1 (valid key)'] },
          );
        }
        throw unavailable(result.notes.join('; '));
      }

      return result.value;
    },

    async synthesize(text, options) {
      assertConfigured();

      const result = await runWithKeyPool<SynthesisResult>({
        pool: config.keyPool,
        plan: config.attemptPlan,
        sleep: config.sleep,
        perform: async (entry) => {
          const body = JSON.stringify({
            model: config.ttsModel,
            target_language_code: options.languageCode,
            speaker: config.ttsSpeaker,
            inputs: [text],
            speech_sample_rate: 22050,
            enable_preprocessing: true,
          });

          const outcome = await attempt(entry, ttsPath, () => ({
            body,
            headers: { 'Content-Type': 'application/json' },
          }));
          if (!outcome.ok) {
            if (outcome.status === 401 || outcome.status === 403) {
              logger.warn('sarvam rejected a key', {
                source: entry.source,
                keyIndex: entry.index,
                key: maskKey(entry.key),
              });
            }
            return { ok: false as const, status: outcome.status, retryAfterMs: outcome.retryAfterMs };
          }

          const payload = (await outcome.response.json()) as { audios?: string[] };
          const audioBase64 = payload.audios?.[0];
          if (!audioBase64) {
            // A well-formed response with no audio is a provider problem, not an
            // auth problem: treat it as transient so the pool may retry.
            return { ok: false as const, status: 502, retryAfterMs: null };
          }
          return { ok: true as const, value: { audioBase64, mimeType: 'audio/wav' } };
        },
      });

      if (!result.ok || !result.value) {
        if (result.failure === 'auth') {
          throw notConfigured('Sarvam rejected the configured API key, so speech playback is unavailable.', {
            missing: ['SARVAM_API_KEY_1 (valid key)'],
          });
        }
        throw new AppError(
          502,
          'SPEECH_ERROR',
          'Speech playback failed. The written answer is still available above.',
          { reason: result.notes.join('; ') },
        );
      }

      return result.value;
    },
  };
}
