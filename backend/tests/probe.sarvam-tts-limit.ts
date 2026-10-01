/**
 * Finds Sarvam's real TTS input limit by reading the provider's own error
 * message. Prints only the provider error text - never the key, never the
 * customer text (only character counts).
 */
import 'dotenv/config';

const key = (process.env.SARVAM_API_KEY_1 || process.env.SARVAM_API_KEY || '').trim();
const model = (process.env.SARVAM_TTS_MODEL || 'bulbul:v3').trim();
const speaker = (process.env.SARVAM_TTS_SPEAKER || 'ritu').trim();

async function attempt(chars) {
  const text = 'আ'.repeat(chars);
  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': key },
    body: JSON.stringify({
      model,
      target_language_code: 'bn-IN',
      speaker,
      inputs: [text],
      speech_sample_rate: 22050,
      enable_preprocessing: true,
    }),
  });
  const raw = await res.text();
  let msg = raw.slice(0, 300);
  try {
    const parsed = JSON.parse(raw);
    msg = parsed.error?.message ?? parsed.detail?.message ?? JSON.stringify(parsed).slice(0, 300);
  } catch {
    /* raw text */
  }
  return { status: res.status, msg };
}

async function main() {
  console.log(`Model: ${model} | Speaker: ${speaker}\n`);

  for (const chars of [500, 900, 1000, 1200, 1500, 2000, 2400, 2500, 2600]) {
    const r = await attempt(chars);
    const verdict = r.status === 200 ? 'ACCEPTED' : 'REJECTED';
    console.log(`${String(chars).padStart(5)} chars -> HTTP ${r.status} ${verdict}`);
    if (r.status !== 200) {
      console.log(`            provider says: ${r.msg}`);
      break; // the first rejection reveals the limit
    }
  }
}

main().catch((e) => {
  console.log('probe failed:', e.message);
  process.exit(1);
});
