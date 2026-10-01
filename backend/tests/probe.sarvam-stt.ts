/**
 * Probes the Sarvam /speech-to-text endpoint to confirm, against the LIVE API,
 * which model + mode combination performs native-language transcription and
 * returns a detected language_code.
 *
 * Official docs (docs.sarvam.ai) state:
 *   - the mode parameter is supported by saaras:v3 and saaras:v4
 *   - saaras:v4 is the default, recommended model
 *   - modes are: transcribe, translate, verbatim, translit, codemix
 *   - /speech-to-text-translate is legacy (saarika/saaras v2.5)
 *
 * We verify rather than assume. No secrets are printed.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync('frontend/.env.local', 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* not needed */
  }
  return env;
}

/** 16-bit PCM WAV containing a spoken-like tone (not real speech). */
function toneWav(seconds = 1.2, sampleRate = 16000, frequency = 180) {
  const samples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 7000);
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

async function probe(env, { model, mode, languageCode, label }) {
  const key = (env.SARVAM_API_KEY_1 || env.SARVAM_API_KEY || '').trim();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(toneWav())], { type: 'audio/wav' }), 'tone.wav');
  form.append('model', model);
  form.append('language_code', languageCode);
  if (mode) form.append('mode', mode);

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': key },
    body: form,
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }

  const ok = response.status === 200;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  console.log(`     model=${model} mode=${mode ?? '(none)'} language_code=${languageCode} -> HTTP ${response.status}`);
  if (ok) {
    console.log(`     response keys: ${Object.keys(body).join(', ')}`);
    console.log(`     language_code returned: ${JSON.stringify(body.language_code)}`);
    console.log(`     transcript: ${JSON.stringify(String(body.transcript ?? '').slice(0, 60))}`);
  } else {
    console.log(`     error: ${JSON.stringify(body).slice(0, 260)}`);
  }
  return ok;
}

async function main() {
  const env = loadEnv();
  console.log('Sarvam STT parameter probe (synthetic audio, no secrets printed)\n');

  await probe(env, { model: 'saaras:v4', mode: 'transcribe', languageCode: 'unknown', label: 'v4 + transcribe + auto-detect' });
  await probe(env, { model: 'saaras:v4', mode: 'transcribe', languageCode: 'bn-IN', label: 'v4 + transcribe + bn-IN' });
  await probe(env, { model: 'saaras:v4', mode: 'transcribe', languageCode: 'hi-IN', label: 'v4 + transcribe + hi-IN' });
  await probe(env, { model: 'saaras:v3', mode: 'transcribe', languageCode: 'unknown', label: 'v3 + transcribe + auto-detect' });
  await probe(env, { model: 'saaras:v4', mode: 'translate', languageCode: 'unknown', label: 'v4 + translate (must NOT be used)' });
  await probe(env, { model: 'saarika:v2.5', mode: undefined, languageCode: 'unknown', label: 'legacy saarika:v2.5 (current default)' });
}

main().catch((e) => {
  console.error('probe error:', e.message);
  process.exit(1);
});
