/**
 * Isolates whether the TTS failure is length-related.
 * Captures the provider's reason from the error details (no keys, no text).
 */
const B = 'http://localhost:8080/api/speech/speak';

async function speak(label, text, language = 'bn') {
  const t0 = Date.now();
  const res = await fetch(B, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  const body = await res.json();
  const ms = Date.now() - t0;
  if (res.status === 200) {
    console.log(`${label.padEnd(30)} HTTP 200  ${ms}ms  audio=${body.audioBase64?.length ?? 0} base64 chars`);
  } else {
    const reason = body.error?.details?.reason ?? '';
    console.log(`${label.padEnd(30)} HTTP ${res.status}  ${ms}ms  code=${body.error?.code}`);
    if (reason) console.log(`${' '.repeat(30)} reason: ${reason.slice(0, 180)}`);
  }
  return res.status;
}

async function main() {
  console.log('Live Sarvam TTS calls (real provider requests)\n');

  // 1. Short, natural Bengali.
  await speak('short (27 chars)', 'হ্যাঁ, আপনার দোকানে চাল আছে।');

  // 2. A long, natural Bengali sentence repeated to ~1000 chars - above the
  //    OLD 800 limit, so this is the case the raise was meant to fix.
  const natural = 'আমাদের দোকানে চাল, ডাল, তেল ও আটা সহ নিত্যপ্রয়োজনীয় সব জিনিস পাওয়া যায়। ';
  await speak('~1000 chars (above old 800)', natural.repeat(Math.ceil(1000 / natural.length)).slice(0, 1000));

  // 3. The exact synthetic case that failed, to capture the provider reason.
  await speak('2400 chars (repeated ক)', 'ক'.repeat(2400));
}

main().catch((e) => {
  console.log('probe failed:', e.message);
  process.exit(1);
});
