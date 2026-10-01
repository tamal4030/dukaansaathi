import { AppError, notConfigured } from '../lib/errors';
import { logger } from '../lib/logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Reasoning effort levels, taken from the API's own validation error:
 *   "expected one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`,
 *    `ultra`, `max`"
 * Verified live against deepseek-flash: the field is accepted, an invalid value
 * returns HTTP 422, and `low` reduced reasoning tokens from 60 to 25 on a
 * sample prompt. Lower effort leaves more of max_tokens for the visible answer,
 * which is the main cause of empty replies on this model.
 */
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'ultra',
  'max',
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  /** Omit to use the provider default. */
  reasoningEffort?: ReasoningEffort;
}

export interface ChatCompletionResult {
  content: string;
}

/**
 * DeepSeek is the only LLM provider in DukaanSaathi. There is intentionally no
 * fallback provider: when DeepSeek is unavailable the API returns a clear error
 * and the transcript stays visible in the UI.
 */
export interface ChatClient {
  complete(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatCompletionResult>;
}

export interface DeepSeekConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
}

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export function createDeepSeekClient(
  config: DeepSeekConfig,
  fetchImpl: typeof fetch = fetch,
): ChatClient {
  const baseUrl = config.baseUrl ?? DEEPSEEK_BASE_URL;

  async function request(messages: ChatMessage[], options: ChatCompletionOptions, jsonMode: boolean) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.timeoutMs);
    try {
      return await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options.temperature ?? 0.2,
          // Reasoning models count reasoning tokens against max_tokens, so
          // this budget must leave room for the visible answer as well.
          max_tokens: options.maxTokens ?? 2500,
          // Only sent when configured: the field is verified to exist, but we
          // do not want to depend on it for correctness.
          ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
          stream: false,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async complete(messages, options = {}) {
      if (!config.apiKey || !config.model) {
        throw notConfigured(
          'The assistant is not configured on the server yet, so I cannot answer right now. Please contact the business directly.',
          {
            missing: [
              ...(config.apiKey ? [] : ['DEEPSEEK_API_KEY']),
              ...(config.model ? [] : ['DEEPSEEK_MODEL']),
            ],
            setup: 'Set DEEPSEEK_API_KEY and DEEPSEEK_MODEL to the current official DeepSeek Flash model id (see docs/DEPLOYMENT.md).',
          },
        );
      }

      const wantsJson = options.jsonMode !== false;
      let response: Response;
      try {
        response = await request(messages, options, wantsJson);
      } catch (error) {
        const reason = (error as Error).name === 'AbortError' ? 'timeout' : (error as Error).message;
        logger.warn('deepseek request failed', { reason });
        throw new AppError(
          504,
          'ASSISTANT_UNAVAILABLE',
          'The assistant is not responding right now. Please try again, or contact the business directly.',
        );
      }

      // Some models reject response_format; retry once as plain text instead of
      // switching providers.
      if (!response.ok && wantsJson && response.status === 400) {
        const bodyText = await response.text();
        logger.warn('deepseek rejected json mode, retrying as text', { body: bodyText.slice(0, 200) });
        try {
          response = await request(messages, options, false);
        } catch {
          throw new AppError(
            504,
            'ASSISTANT_UNAVAILABLE',
            'The assistant is not responding right now. Please try again.',
          );
        }
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        logger.warn('deepseek error response', { status: response.status, body: bodyText.slice(0, 300) });
        if (response.status === 401 || response.status === 403) {
          throw notConfigured('The assistant could not authenticate with DeepSeek. Please check DEEPSEEK_API_KEY.', {
            missing: ['DEEPSEEK_API_KEY (valid key)'],
          });
        }
        if (response.status === 404) {
          throw notConfigured(
            `DeepSeek does not recognise the model "${config.model}". Update DEEPSEEK_MODEL to the current official Flash model id.`,
            { missing: ['DEEPSEEK_MODEL (valid model id)'] },
          );
        }
        if (response.status === 429) {
          throw new AppError(429, 'ASSISTANT_BUSY', 'The assistant is busy right now. Please try again in a moment.');
        }
        throw new AppError(
          502,
          'ASSISTANT_ERROR',
          'The assistant could not answer that just now. Please try again.',
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }>;
      };
      const choice = payload.choices?.[0];
      const content = choice?.message?.content ?? '';
      if (!content.trim()) {
        // Reasoning models emit reasoning_content first. If the token budget
        // was consumed by reasoning, content is empty even though the call
        // succeeded - so say that plainly instead of "empty answer".
        const reasoning = choice?.message?.reasoning_content ?? '';
        logger.warn('deepseek returned no visible content', {
          finishReason: choice?.finish_reason,
          reasoningChars: reasoning.length,
        });
        // The caller may retry once with a shorter context. The code is stable
        // so it can be caught by code, not by matching the message text.
        throw new AppError(
          502,
          'ASSISTANT_EMPTY',
          reasoning.length > 0
            ? 'The assistant used its whole answer budget on internal reasoning.'
            : 'The assistant returned an empty answer.',
          { reasoningChars: reasoning.length, finishReason: choice?.finish_reason ?? null },
        );
      }
      return { content };
    },
  };
}
