/**
 * Minimal DeepSeek check. Two requests, both tiny:
 *   1. GET /models  - free, verifies the key authenticates
 *   2. one chat call with a short prompt and a small token budget
 *
 * Never prints the key. Prints only statuses, the model id, and the reply text.
 */
import 'dotenv/config';

const key = (process.env.DEEPSEEK_API_KEY || '').trim();
const model = (process.env.DEEPSEEK_MODEL || '').trim();
const base = 'https://api.deepseek.com';

async function main() {
  console.log('=== 1. Auth check: GET /models (free) ===');
  const listRes = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  console.log('HTTP', listRes.status);

  if (listRes.status === 401 || listRes.status === 403) {
    console.log('RESULT: KEY REJECTED by DeepSeek.');
    console.log('body:', (await listRes.text()).slice(0, 200));
    process.exit(1);
  }
  if (listRes.ok) {
    const body = await listRes.json();
    const ids = (body.data || []).map((m) => m.id);
    console.log('models available to this key:', JSON.stringify(ids));
    console.log('configured DEEPSEEK_MODEL is in that list:', ids.includes(model));
  }

  console.log('');
  console.log('=== 2. One small chat call ===');
  const started = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
      max_tokens: 300,
      stream: false,
    }),
  });
  const ms = Date.now() - started;
  console.log('HTTP', res.status, `in ${ms}ms`);

  if (!res.ok) {
    console.log('body:', (await res.text()).slice(0, 400));
    process.exit(1);
  }

  const body = await res.json();
  const choice = body.choices?.[0];
  const content = choice?.message?.content ?? '';
  const reasoning = choice?.message?.reasoning_content ?? '';

  console.log('model returned :', body.model);
  console.log('finish_reason  :', choice?.finish_reason);
  console.log('reasoning chars:', reasoning.length);
  console.log('content        :', JSON.stringify(content));
  console.log('usage          :', JSON.stringify(body.usage));

  if (content.trim().length > 0) {
    console.log('');
    console.log('RESULT: WORKING');
    process.exit(0);
  }

  console.log('');
  console.log('RESULT: responded but produced no visible content (reasoning ate the budget).');
  process.exit(2);
}

main().catch((e) => {
  console.log('REQUEST FAILED:', e.message);
  process.exit(1);
});
