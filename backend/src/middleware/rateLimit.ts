import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.rateLimitDisabled,
};

/**
 * In-memory limiter: fine for a single Render instance. A shared store
 * (for example Redis) is required if the service is scaled horizontally.
 */
export const publicLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: Math.max(10, env.publicRateLimitPerMinute),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
});

export const aiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: Math.max(2, env.aiRateLimitPerMinute),
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'You are sending messages very quickly. Please wait a moment and try again.',
    },
  },
});

export const speechLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: Math.max(3, Math.ceil(env.aiRateLimitPerMinute / 2)),
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many voice requests. Please wait a moment.' },
  },
});
