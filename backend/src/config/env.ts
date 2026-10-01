import 'dotenv/config';
import { buildSarvamKeyPool } from '../services/sarvamKeys';

/**
 * Speech keys are read as a pool (SARVAM_API_KEY_1..3 plus the legacy
 * SARVAM_API_KEY). Values are never logged; only the count is reported.
 */
export function sarvamKeyPool() {
  return buildSarvamKeyPool(process.env as Record<string, string | undefined>);
}

function str(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : String(value).trim();
}

function num(name: string, fallback: number): number {
  const raw = str(name);
  const parsed = Number(raw);
  return raw === '' || Number.isNaN(parsed) ? fallback : parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = str(name).toLowerCase();
  if (raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function list(name: string): string[] {
  return str(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const nodeEnv = str('NODE_ENV', 'development');
const isTest = nodeEnv === 'test';

export const env = {
  nodeEnv,
  isTest,
  isProduction: nodeEnv === 'production',
  port: num('PORT', 8080),

  databaseUrl: str('DATABASE_URL'),
  directUrl: str('DIRECT_URL') || undefined,

  supabaseUrl: str('SUPABASE_URL').replace(/\/$/, ''),
  supabaseAnonKey: str('SUPABASE_ANON_KEY'),
  supabaseJwtSecret: str('SUPABASE_JWT_SECRET'),

  deepseekApiKey: str('DEEPSEEK_API_KEY'),
  deepseekModel: str('DEEPSEEK_MODEL'),
  deepseekTimeoutMs: num('DEEPSEEK_TIMEOUT_MS', 25000),

  // Speech keys: SARVAM_API_KEY_1..3 are preferred, SARVAM_API_KEY is kept for
  // backward compatibility. See services/sarvamKeys.ts for selection rules.
  sarvamApiKey: str('SARVAM_API_KEY'),
  sarvamSttModel: str('SARVAM_STT_MODEL', 'saaras:v4'),
  // Must remain 'transcribe': translation modes would return English for
  // Bengali/Hindi speech.
  sarvamSttMode: str('SARVAM_STT_MODE', 'transcribe'),
  sarvamTtsModel: str('SARVAM_TTS_MODEL', 'bulbul:v3'),
  sarvamTtsSpeaker: str('SARVAM_TTS_SPEAKER', 'ritu'),

  resendApiKey: str('RESEND_API_KEY'),
  emailFrom: str('EMAIL_FROM'),

  frontendUrl: str('FRONTEND_URL', 'http://localhost:5173'),
  corsAllowedOrigins: list('CORS_ALLOWED_ORIGINS'),

  requireGoogleForOrders: bool('REQUIRE_GOOGLE_FOR_ORDERS', true),
  aiRateLimitPerMinute: num('AI_RATE_LIMIT_PER_MINUTE', 12),
  publicRateLimitPerMinute: num('PUBLIC_RATE_LIMIT_PER_MINUTE', 120),
  rateLimitDisabled: bool('RATE_LIMIT_DISABLED', isTest),
};

export const features = {
  database: () => Boolean(env.databaseUrl),
  supabaseAuth: () => Boolean(env.supabaseUrl && (env.supabaseAnonKey || env.supabaseJwtSecret)),
  assistant: () => Boolean(env.deepseekApiKey && env.deepseekModel),
  speechToText: () => sarvamKeyPool().length > 0,
  speechToSpeech: () => sarvamKeyPool().length > 0,
  email: () => Boolean(env.resendApiKey && env.emailFrom),
};

export function missingEnvFor(feature: keyof typeof features): string[] {
  switch (feature) {
    case 'database':
      return env.databaseUrl ? [] : ['DATABASE_URL'];
    case 'supabaseAuth':
      return [
        ...(env.supabaseUrl ? [] : ['SUPABASE_URL']),
        ...(env.supabaseAnonKey || env.supabaseJwtSecret ? [] : ['SUPABASE_ANON_KEY or SUPABASE_JWT_SECRET']),
      ];
    case 'assistant':
      return [
        ...(env.deepseekApiKey ? [] : ['DEEPSEEK_API_KEY']),
        ...(env.deepseekModel ? [] : ['DEEPSEEK_MODEL (current official DeepSeek Flash model id)']),
      ];
    case 'speechToText':
    case 'speechToSpeech':
      return sarvamKeyPool().length > 0 ? [] : ['SARVAM_API_KEY_1 (or SARVAM_API_KEY)'];
    case 'email':
      return [
        ...(env.resendApiKey ? [] : ['RESEND_API_KEY']),
        ...(env.emailFrom ? [] : ['EMAIL_FROM']),
      ];
    default:
      return [];
  }
}
