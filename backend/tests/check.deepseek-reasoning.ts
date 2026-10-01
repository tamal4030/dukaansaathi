/**
 * Verifies whether deepseek-flash accepts a `reasoning_effort` field, and
 * whether lowering it actually reduces reasoning tokens.
 *
 * The official docs page was unreachable from this environment, so instead of
 * guessing we test the field against the live API and measure. Two tiny calls.
 * Never prints the key.
 */
import 'dotenv/config';

const key = (process.env.DEEPSEEK_API_KEY || '').trim();
const model = (process.env.DEEPSEEK_MODEL || '').trim();

async function call(label, extra) {
  const body = {
    model,
    messages: [{ role: 'user', content: 'What is 2+2? Answer in one short sentence.' }],
    max_tokens: 500,
    stream: false,
    ...extra,
  };
  const started = Date.now();
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  const text = await res.text();

  if (!res.ok) {
    let msg = text.slice(0, 200);
    try {
      msg = JSON.parse(text).error?.message ?? msg;
    } catch {
      /* raw */
    }
    console.log(`${label.padEnd(26)} HTTP ${res.status}  ${ms}ms  REJECTED: ${msg}`);
    return null;
  }

  const parsed = JSON.parse(text);
  const usage = parsed.usage ?? {};
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const content = parsed.choices?.[0]?.message?.content ?? '';
  console.log(
    `${label.padEnd(26)} HTTP 200  ${ms}ms  reasoning=${reasoningTokens} completion=${usage.completion_tokens ?? '?'} content=${JSON.stringify(content.slice(0, 40))}`,
  );
  return { reasoningTokens, ms };
}

async function main() {
  console.log('Testing whether the API accepts reasoning_effort on', model, '\n');

  const baseline = await call('no reasoning_effort', {});
  const low = await call('reasoning_effort=low', { reasoning_effort: 'low' });
  const high = await call('reasoning_effort=high', { reasoning_effort: 'high' });
  const bogus = await call('reasoning_effort=bogus', { reasoning_effort: 'bogus' });

  console.log('');
  console.log('--- verdict ---');
  if (low === null && high === null && bogus === null) {
    console.log('reasoning_effort is NOT accepted by this model. Do not send it.');
  } else if (bogus !== null) {
    console.log('The field is accepted but an invalid value is tolerated, so it may be ignored.');
  } else {
    console.log('reasoning_effort IS accepted (bogus value rejected).');
    if (baseline && low) {
      console.log(`reasoning tokens: baseline=${baseline.reasoningTokens} low=${low.reasoningTokens}`);
      console.log(
        low.reasoningTokens < baseline.reasoningTokens
          ? '=> lowering effort REDUCES reasoning tokens. Safe to use.'
          : '=> lowering effort did NOT reduce tokens in this sample. Not worth relying on.',
      );
    }
  }
}

main().catch((e) => {
  console.log('FAILED:', e.message);
  process.exit(1);
});
