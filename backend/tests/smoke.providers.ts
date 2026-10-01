/**
 * Minimal live-provider smoke test.
 *
 * Makes ONE tiny call per provider to confirm that the configured endpoint,
 * model identifier and credentials actually work. It deliberately does not
 * test behaviour, load, or error paths.
 *
 * Secrets are never printed. Only lengths, statuses and short response
 * excerpts are reported.
 *
 * Run:  npx tsx tests/smoke.providers.ts
 */
import 'dotenv/config';
import { createDeepSeekClient } from '../src/services/deepseek';
import { createSarvamClient, sarvamConfigFromEnv } from '../src/services/sarvam';

const env = process.env as Record<string, string | undefined>;

function mask(label: string, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return `${label}: MISSING`;
  return `${label}: set (len=${v.length})`;
}

async function smokeDeepSeek(): Promise<boolean> {
  console.log('\n=== DeepSeek ===');
  console.log(mask('DEEPSEEK_API_KEY', env.DEEPSEEK_API_KEY));
  console.log(mask('DEEPSEEK_MODEL', env.DEEPSEEK_MODEL));

  const client = createDeepSeekClient({
    apiKey: (env.DEEPSEEK_API_KEY ?? '').trim(),
    model: (env.DEEPSEEK_MODEL ?? '').trim(),
    timeoutMs: 30000,
  });

  // NOTE: the configured model is a *reasoning* model. Reasoning tokens count
  // against max_tokens, so a small budget is consumed entirely by reasoning and
  // returns empty content with finish_reason=length. Budgets must leave room
  // for the visible answer.
  try {
    const started = Date.now();
    const result = await client.complete(
      [
        { role: 'system', content: 'Reply with the single word: ok' },
        { role: 'user', content: 'ping' },
      ],
      { maxTokens: 800, jsonMode: false },
    );
    const ms = Date.now() - started;
    console.log(`PASS  DeepSeek plain completion responded in ${ms}ms`);
    console.log(`      reply: ${JSON.stringify(result.content.slice(0, 120))}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  DeepSeek plain completion failed: ${message}`);
    return false;
  }

  // JSON mode is what the assistant actually uses. Some models reject
  // response_format, so this must be confirmed separately.
  try {
    const started = Date.now();
    const result = await client.complete(
      [
        { role: 'system', content: 'Reply only as JSON: {"reply": "<text>"}' },
        { role: 'user', content: 'Say hello in one word.' },
      ],
      { maxTokens: 800, jsonMode: true },
    );
    const ms = Date.now() - started;
    console.log(`PASS  DeepSeek JSON mode responded in ${ms}ms`);
    console.log(`      content: ${JSON.stringify(result.content.slice(0, 160))}`);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      parsed = null;
    }
    console.log(`      parses as JSON: ${parsed !== null}`);
    return parsed !== null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  DeepSeek JSON mode failed: ${message}`);
    if (error && typeof error === 'object' && 'details' in error) {
      console.log(`      details: ${JSON.stringify((error as { details?: unknown }).details)}`);
    }
    return false;
  }
}

/** Builds a minimal 16-bit PCM WAV containing a short tone. */
function toneWav(seconds = 1, sampleRate = 16000, frequency = 220): Buffer {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 8000);
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function smokeSarvam(): Promise<boolean> {
  console.log('\n=== Sarvam ===');
  const config = sarvamConfigFromEnv(env);
  console.log(`key pool size: ${config.keyPool.length}`);
  console.log(mask('SARVAM_STT_MODEL', config.sttModel));
  console.log(mask('SARVAM_TTS_MODEL', config.ttsModel));
  console.log(`base URL: ${config.baseUrl}`);
  console.log(`STT path: ${config.sttPath}`);
  console.log(`TTS path: ${config.ttsPath}`);

  const client = createSarvamClient(config);
  let ok = true;

  // --- TTS: proves the endpoint, auth and model id in one small call.
  try {
    const started = Date.now();
    const audio = await client.synthesize('নমস্কার', { languageCode: 'bn-IN' });
    console.log(`PASS  Sarvam TTS returned ${audio.audioBase64.length} base64 chars in ${Date.now() - started}ms`);
    console.log(`      mimeType: ${audio.mimeType}`);
  } catch (error) {
    ok = false;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  Sarvam TTS failed: ${message}`);
    if (error && typeof error === 'object' && 'details' in error) {
      console.log(`      details: ${JSON.stringify((error as { details?: unknown }).details)}`);
    }
  }

  // --- STT: a synthetic tone, not real speech. This proves the endpoint and
  //     auth work; it does not prove transcription accuracy.
  try {
    const started = Date.now();
    const result = await client.transcribe(toneWav(), {
      filename: 'tone.wav',
      mimetype: 'audio/wav',
      languageCode: 'unknown',
    });
    console.log(`PASS  Sarvam STT accepted the request in ${Date.now() - started}ms`);
    console.log(`      transcript: ${JSON.stringify(result.transcript)} (synthetic tone, so empty text is expected)`);
    console.log(`      detected language: ${result.languageCode ?? 'n/a'}`);
  } catch (error) {
    ok = false;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  Sarvam STT failed: ${message}`);
  }

  return ok;
}

async function main() {
  console.log('Live provider smoke test - minimal single calls, no secrets printed.');
  const deep = await smokeDeepSeek();
  const sarvam = await smokeSarvam();

  console.log('\n' + '='.repeat(60));
  console.log(`DeepSeek: ${deep ? 'WORKING' : 'FAILED'}`);
  console.log(`Sarvam:   ${sarvam ? 'WORKING' : 'FAILED'}`);
  process.exit(deep && sarvam ? 0 : 1);
}

main().catch((error) => {
  console.error('Smoke test error:', error);
  process.exit(1);
});
