import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const EDGE = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find(existsSync);

const WEB = 'https://dukaansaathi-two.vercel.app';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const apiCalls = [];
const failures = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('onrender.com')) apiCalls.push({ status: r.status(), url: u.replace(/^https:\/\/[^/]+/, '') });
  if (r.status() >= 400) failures.push(`${r.status()} ${u.slice(0, 100)}`);
});
page.on('pageerror', (e) => failures.push('PAGEERROR: ' + e.message.slice(0, 120)));

async function visit(path, label) {
  await page.goto(WEB + path, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  const h1 = (await page.locator('h1').first().textContent().catch(() => '')) || '(none)';
  const len = (await page.locator('body').innerText().catch(() => '')).length;
  console.log(`${label.padEnd(18)} h1="${h1.trim().slice(0, 40)}"  text=${len}`);
}

console.log('=== LIVE SITE RENDER (mobile 390x844) ===');
await visit('/', 'Landing');
await visit('/explore', 'Explore');
await visit('/business/login', 'Business login');
await visit('/auth/customer', 'Customer signin');

console.log('');
console.log('=== EXPLORE: are shops actually listed? ===');
await page.goto(WEB + '/explore', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
const cards = await page.locator('a[href^="/business/"]').count();
console.log('  business cards rendered:', cards);
const first = await page.locator('a[href^="/business/"]').first().innerText().catch(() => '');
console.log('  first card:', JSON.stringify(first.replace(/\s+/g, ' ').slice(0, 100)));

console.log('');
console.log('=== OPEN A SHOP ===');
await page.locator('a[href^="/business/"]').first().click();
await page.waitForTimeout(4000);
console.log('  URL:', page.url().replace(WEB, ''));
console.log('  h1 :', ((await page.locator('h1').first().textContent().catch(() => '')) || '').trim());

console.log('');
console.log('=== API CALLS THE PAGE MADE ===');
apiCalls.slice(0, 8).forEach((c) => console.log('  ', c.status, c.url));
console.log('  total API calls:', apiCalls.length);

console.log('');
console.log('=== FAILURES ===');
if (failures.length === 0) console.log('  none');
failures.slice(0, 8).forEach((f) => console.log('  ', f));

await browser.close();
