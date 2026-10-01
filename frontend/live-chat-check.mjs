import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const EDGE = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find(existsSync);

const WEB = 'https://dukaansaathi-two.vercel.app';
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const apiCalls = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('onrender.com')) apiCalls.push({ status: r.status(), path: u.replace(/^https:\/\/[^/]+/, '').split('?')[0] });
});

await page.goto(WEB + '/business/demo-annapurna-tiffin', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);

const panel = page.locator('section[aria-labelledby="chat-heading"]');
const input = page.locator('#chat-input');

await input.fill('Do you have fish curry and what does it cost?');
await page.getByRole('button', { name: /^Send$/i }).click();
console.log('message sent, waiting for the assistant...\n');

// Poll only inside the chat panel, excluding the intro paragraph.
let transcript = '';
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(6000);
  transcript = (await panel.innerText().catch(() => '')) || '';
  const lines = transcript.split('\n').map((l) => l.trim()).filter(Boolean);
  // The assistant bubble is any line that is not the intro/heading/note.
  const substantial = lines.filter(
    (l) => l.length > 40 && !/^Ask /i.test(l) && !/guest/i.test(l) && !/Type your question/i.test(l) && !/^Send$/i.test(l),
  );
  if (substantial.length >= 2) {
    console.log(`reply detected after ~${(i + 1) * 6}s\n`);
    break;
  }
  if (i === 19) console.log('no reply within 120s\n');
}

console.log('=== CHAT PANEL TRANSCRIPT ===');
transcript.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).forEach((l) => console.log('  ' + l.slice(0, 120)));

console.log('');
console.log('=== CHAT API CALLS ===');
apiCalls.filter((c) => c.path.includes('conversation')).forEach((c) => console.log('  ', c.status, c.path));

await page.screenshot({ path: 'live-chat.png' }).catch(() => {});
console.log('\nscreenshot: frontend/live-chat.png');
await browser.close();
