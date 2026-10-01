/**
 * Raw provider diagnostics. Prints response STRUCTURE and provider error
 * messages only - never a credential. Safe to run and paste.
 */
import 'dotenv/config';

const env = process.env as Record<string, string | undefined>;

async function diagnoseDeepSeek() {
  console.log('\n=== DeepSeek raw response ===');
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${(env.DEEPSEEK_API_KEY ?? '').trim()}`,
    },
    body: JSON.stringify({
      model: (env.DEEPSEEK_MODEL ?? '').trim(),
      messages: [{ role: 'user', content: 'Say ok' }],
      max_tokens: 64,
      stream: false,
    }),
  });
  console.log('HTTP status:', response.status);
  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.log('non-JSON body:', text.slice(0, 400));
    return;
  }
  if (response.status !== 200) {
    console.log('error body:', JSON.stringify(parsed).slice(0, 600));
    return;
  }
  console.log('top-level keys:', Object.keys(parsed).join(', '));
  const choice = parsed.choices?.[0];
  console.log('choice keys:', choice ? Object.keys(choice).join(', ') : 'none');
  console.log('finish_reason:', choice?.finish_reason);
  console.log('message keys:', choice?.message ? Object.keys(choice.message).join(', ') : 'none');
  console.log('content:', JSON.stringify(choice?.message?.content));
  console.log('reasoning_content present:', Boolean(choice?.message?.reasoning_content));
  if (choice?.message?.reasoning_content) {
    console.log('reasoning length:', String(choice.message.reasoning_content).length);
  }
  console.log('usage:', JSON.stringify(parsed.usage));
}

async function diagnoseSarvamTts() {
  console.log('\n=== Sarvam TTS raw response ===');
  const key = (env.SARVAM_API_KEY_1 ?? '').trim();
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': key },
    body: JSON.stringify({
      model: (env.SARVAM_TTS_MODEL ?? 'bulbul:v2').trim(),
      target_language_code: 'bn-IN',
      speaker: (env.SARVAM_TTS_SPEAKER ?? 'anushka').trim(),
      inputs: ['নমস্কার'],
      speech_sample_rate: 22050,
      enable_preprocessing: true,
    }),
  });
  console.log('HTTP status:', response.status);
  const text = await response.text();
  console.log('body (truncated):', text.slice(0, 700));
}

async function diagnoseSarvamModels() {
  console.log('\n=== Sarvam TTS with minimal payload (model only) ===');
  const key = (env.SARVAM_API_KEY_1 ?? '').trim();
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': key },
    body: JSON.stringify({
      text: 'নমস্কার',
      target_language_code: 'bn-IN',
      speaker: (env.SARVAM_TTS_SPEAKER ?? 'anushka').trim(),
    }),
  });
  console.log('HTTP status:', response.status);
  const text = await response.text();
  console.log('body (truncated):', text.slice(0, 700));
}

async function main() {
  await diagnoseDeepSeek();
  await diagnoseSarvamTts();
  await diagnoseSarvamModels();
}

main().catch((error) => {
  console.error('diagnostic error:', error);
  process.exit(1);
});
