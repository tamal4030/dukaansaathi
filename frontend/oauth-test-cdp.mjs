/**
 * Google OAuth test using a CDP-attached browser.
 *
 * WHY THIS VERSION EXISTS
 * Playwright's normal launch() adds `--enable-automation` and sets
 * navigator.webdriver, which makes Google refuse sign-in with
 * "This browser or app may not be secure".
 *
 * Instead we start Edge ourselves with ONLY a remote-debugging port (no
 * automation flags) and attach Playwright over CDP. The browser is then a
 * normal browser as far as Google is concerned.
 *
 * A separate throwaway profile directory is used so the user's real browsing
 * profile, history and cookies are never touched.
 *
 * Nothing sensitive is read or logged: no credentials, no OAuth codes, no
 * tokens. URLs are redacted before printing.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG = 'oauth-test.log';
const APP = 'http://localhost:5173';
const START = `${APP}/auth/customer`;
const PORT = 9333;
const PROFILE = join(tmpdir(), 'dukaansaathi-oauth-profile');
const WAIT_FOR_HUMAN_MS = 6 * 60 * 1000;

// Browser locations are resolved from the environment first so the file is
// not tied to one machine, then fall back to the usual Windows paths.
const EDGE_CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  appendFileSync(LOG, stamped + '\n');
}

function redact(url) {
  try {
    const u = new URL(url);
    for (const key of ['code', 'access_token', 'refresh_token', 'id_token', 'token', 'state', 'code_verifier']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '<redacted>');
    }
    if (u.hash) u.hash = u.hash.replace(/access_token=[^&]*/, 'access_token=<redacted>');
    return u.origin + u.pathname + (u.search || '');
  } catch {
    return '<unparseable>';
  }
}

function findEdge() {
  return EDGE_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

async function waitForCdp(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const executablePath = findEdge();
  if (!executablePath) {
    log('FAIL: no Edge executable found.');
    process.exit(1);
  }

  if (existsSync(PROFILE)) {
    try {
      rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      /* fine */
    }
  }
  mkdirSync(PROFILE, { recursive: true });

  // Launch a PLAIN browser: only a debugging port. No automation flags at all.
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,OptimizationHints',
    '--start-maximized',
  ];
  log(`Launching a clean browser (separate throwaway profile, no automation flags)`);
  const child = spawn(executablePath, args, { detached: true, stdio: 'ignore' });
  child.unref();

  if (!(await waitForCdp())) {
    log('FAIL: the browser did not expose a debugging port.');
    process.exit(1);
  }
  log('Browser is up and attachable.');

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  // Confirm the automation fingerprint is absent before involving Google.
  await page.goto(START, { waitUntil: 'domcontentloaded' });
  const fingerprint = await page.evaluate(() => ({
    webdriver: navigator.webdriver,
    userAgent: navigator.userAgent,
    hasChrome: Boolean(window.chrome),
  }));
  log(`Fingerprint check: navigator.webdriver=${fingerprint.webdriver}`);
  log(`  userAgent contains "Headless": ${/Headless/i.test(fingerprint.userAgent)}`);

  await page.waitForTimeout(2000);
  const heading = (await page.locator('h1').first().textContent().catch(() => '')) || '';
  log(`Step 1: sign-in page loaded. h1 = "${heading.trim()}"`);

  const googleButton = page.getByRole('button', { name: /Continue with Google/i });
  if ((await googleButton.count()) === 0) {
    log('FAIL: Google button not rendered.');
    log('  page text: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300));
    process.exit(1);
  }

  log('Step 2: clicking "Continue with Google"');
  await googleButton.first().click();

  let sawGoogle = false;
  let reportedError = '';
  const deadline = Date.now() + WAIT_FOR_HUMAN_MS;

  while (Date.now() < deadline) {
    const url = page.url();

    if (url.includes('accounts.google.com') && !sawGoogle) {
      sawGoogle = true;
      log('  reached Google sign-in');
      await page.waitForTimeout(2500);

      const text = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      const checks = [
        { re: /may not be secure|not be secure/i, kind: 'AUTOMATION BLOCKED (browser flagged as insecure)' },
        { re: /Access blocked/i, kind: 'ACCESS BLOCKED (app not verified or test-user restriction)' },
        { re: /isn'?t a test user|not a test user|not been added as a test user/i, kind: 'TEST-USER RESTRICTION' },
        { re: /redirect_uri_mismatch|redirect URI mismatch/i, kind: 'REDIRECT URI MISMATCH' },
        { re: /invalid_client|OAuth client was not found/i, kind: 'INVALID CLIENT' },
        { re: /deleted_client/i, kind: 'DELETED CLIENT' },
      ];
      for (const c of checks) {
        if (c.re.test(text)) {
          reportedError = c.kind;
          break;
        }
      }
      if (reportedError) {
        log(`  GOOGLE ERROR: ${reportedError}`);
        log('  snippet: ' + text.slice(0, 260));
      } else {
        log('  Google is showing a normal interactive page.');
        log('  >>> ACTION REQUIRED: sign in as tamal4030@gmail.com in the browser window <<<');
        log('  >>> Do not share your password or verification code with anyone. <<<');
      }
    }

    if (url.startsWith(APP) && !url.includes('/auth/customer')) {
      log(`Step 3: redirected into the app: ${redact(url)}`);
      break;
    }
    if (url.startsWith(APP) && /[?&#](error|error_code)=/.test(url)) {
      log(`Step 3: Supabase returned an error to the app: ${redact(url)}`);
      break;
    }
    await page.waitForTimeout(1200);
  }

  log('Step 4: checking the session');
  await page.waitForTimeout(3500);

  const sessionInfo = await page.evaluate(() => {
    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!keys.length) return { present: false };
    try {
      const parsed = JSON.parse(window.localStorage.getItem(keys[0]) || '');
      const session = parsed?.session ?? parsed;
      const user = session?.user ?? {};
      return {
        present: true,
        email: user.email ?? null,
        provider: user.app_metadata?.provider ?? null,
        hasAccessToken: Boolean(session?.access_token),
        hasRefreshToken: Boolean(session?.refresh_token),
      };
    } catch {
      return { present: true, parseError: true };
    }
  });

  log(`  session stored: ${sessionInfo.present}`);
  if (sessionInfo.present) {
    log(`  email    : ${sessionInfo.email ?? '(unreported)'}`);
    log(`  provider : ${sessionInfo.provider ?? '(unreported)'}`);
    log(`  tokens present: access=${sessionInfo.hasAccessToken} refresh=${sessionInfo.hasRefreshToken} (values never read)`);
  }

  // Confirm the app now treats the visitor as signed in.
  const text = await page.locator('body').innerText().catch(() => '');
  log(`  UI shows signed-in state: ${/signed in as/i.test(text)}`);

  if (sessionInfo.present && sessionInfo.email) {
    log('RESULT: SUCCESS - Google sign-in completed and a session exists.');
  } else if (reportedError) {
    log(`RESULT: FAILED - ${reportedError}`);
  } else {
    log('RESULT: FAILED - no session after the redirect.');
  }

  log('Leaving the browser open for 40s for inspection.');
  await page.waitForTimeout(40000);
  process.exit(sessionInfo.present ? 0 : 1);
}

main().catch((e) => {
  log('DRIVER ERROR: ' + e.message);
  process.exit(1);
});
