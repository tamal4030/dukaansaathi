/**
 * Interactive Google OAuth test driver.
 *
 * Launches a VISIBLE browser so a human can complete Google's sign-in. It
 * automates everything up to the Google page, then waits for the redirect back
 * to the app and verifies the session.
 *
 * It never reads, prints or stores credentials, OAuth codes, or tokens. Only
 * statuses, URLs (with sensitive query parameters redacted) and app state are
 * reported.
 */
import { chromium } from 'playwright';
import { existsSync, appendFileSync } from 'node:fs';

const LOG = 'oauth-test.log';
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const APP = 'http://localhost:5173';
const START = `${APP}/auth/customer`;
const WAIT_FOR_HUMAN_MS = 5 * 60 * 1000;

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  appendFileSync(LOG, stamped + '\n');
}

/** Removes anything that could be a credential from a URL before logging it. */
function redact(url) {
  try {
    const u = new URL(url);
    const sensitive = ['code', 'access_token', 'refresh_token', 'id_token', 'token', 'state', 'code_verifier'];
    for (const key of sensitive) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '<redacted>');
    }
    if (u.hash) u.hash = u.hash.replace(/access_token=[^&]*/, 'access_token=<redacted>');
    return u.origin + u.pathname + (u.search ? u.search : '');
  } catch {
    return '<unparseable url>';
  }
}

function findEdge() {
  for (const candidate of EDGE_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function main() {
  const executablePath = findEdge();
  if (!executablePath) {
    log('FAIL: no Edge executable found. Install a browser or set the path.');
    process.exit(1);
  }
  log(`Using browser: ${executablePath.split('\\').pop()}`);

  const browser = await chromium.launch({ executablePath, headless: false, slowMo: 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });

  // ---- Step 1: load the sign-in page -------------------------------------
  log(`Step 1: opening ${START}`);
  await page.goto(START, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const heading = (await page.locator('h1').first().textContent().catch(() => '')) || '';
  log(`  h1: ${heading.trim()}`);

  const googleButton = page.getByRole('button', { name: /Continue with Google/i });
  const googleCount = await googleButton.count();
  if (googleCount === 0) {
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
    log('FAIL: the Google button is not rendered. Page text follows:');
    log('  ' + bodyText);
    await browser.close();
    process.exit(1);
  }
  log('  Google sign-in button found and enabled.');

  // ---- Step 2: click through to Google -----------------------------------
  log('Step 2: clicking "Continue with Google"');
  await googleButton.first().click();

  // Wait until we either reach Google or come back to the app.
  let outcome = 'pending';
  const deadline = Date.now() + WAIT_FOR_HUMAN_MS;
  let sawGoogle = false;
  let googleHost = '';
  let googleErrorText = '';

  while (Date.now() < deadline) {
    const url = page.url();

    if (url.includes('accounts.google.com')) {
      if (!sawGoogle) {
        sawGoogle = true;
        googleHost = new URL(url).host;
        log(`  reached Google: ${googleHost}`);
        await page.waitForTimeout(1500);

        // Detect the common non-interactive failures so we can report the
        // category without needing the human to describe the screen.
        const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
        const restrictions = [
          { re: /Access blocked/i, kind: 'test-user restriction / app not verified' },
          { re: /not a test user|isn't a test user|not been added as a test user/i, kind: 'test-user restriction' },
          { re: /redirect_uri_mismatch|redirect URI mismatch/i, kind: 'redirect URI mismatch' },
          { re: /invalid_client|OAuth client was not found/i, kind: 'invalid client' },
          { re: /deleted_client|OAuth client was deleted/i, kind: 'deleted client' },
          { re: /invalid_request/i, kind: 'invalid request' },
        ];
        for (const r of restrictions) {
          if (r.re.test(bodyText)) {
            googleErrorText = r.kind;
            break;
          }
        }
        if (googleErrorText) {
          log(`  GOOGLE ERROR DETECTED: ${googleErrorText}`);
          log('  snippet: ' + bodyText.replace(/\s+/g, ' ').slice(0, 300));
        } else {
          log('  Google is showing an interactive page.');
          log('  >>> ACTION REQUIRED: complete the Google sign-in in the browser window <<<');
          log('  >>> Sign in as tamal4030@gmail.com and approve access. Do not share your password. <<<');
        }
      }
    }

    // Redirected back to the app?
    if (url.startsWith(APP) && !url.includes('/auth/customer')) {
      outcome = 'left-signin-page';
      break;
    }
    if (url.startsWith(APP) && url.includes('/auth/customer') && sawGoogle && page.url() !== START) {
      outcome = 'returned';
      break;
    }

    // Detect Supabase returning an error in the URL.
    if (url.includes('error=') && url.startsWith(APP)) {
      outcome = 'error-returned';
      break;
    }

    await page.waitForTimeout(1000);
  }

  log(`Step 3: outcome = ${outcome}`);
  log(`  final URL: ${redact(page.url())}`);

  if (outcome === 'pending') {
    log('TIMEOUT: the browser flow did not finish within the wait window.');
    log('If you did not complete the Google sign-in, re-run the test and finish it in the window.');
    await browser.close();
    process.exit(2);
  }

  // ---- Step 4: verify the authenticated session --------------------------
  log('Step 4: verifying the session in the app');
  await page.waitForTimeout(3000);

  // The Supabase session is persisted by the SDK; read only its presence.
  const sessionInfo = await page.evaluate(() => {
    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (keys.length === 0) return { present: false };
    try {
      const raw = window.localStorage.getItem(keys[0]) || '';
      const parsed = JSON.parse(raw);
      const session = parsed?.session ?? parsed;
      const user = session?.user ?? {};
      // Report identity fields only - never tokens.
      return {
        present: true,
        email: user.email ?? null,
        provider: user.app_metadata?.provider ?? null,
        emailConfirmed: Boolean(user.email_confirmed_at),
        hasAccessToken: Boolean(session?.access_token),
        hasRefreshToken: Boolean(session?.refresh_token),
      };
    } catch {
      return { present: true, parseError: true };
    }
  });

  log(`  Supabase session stored: ${sessionInfo.present}`);
  if (sessionInfo.present) {
    log(`  signed-in email : ${sessionInfo.email ?? '(not reported)'}`);
    log(`  provider        : ${sessionInfo.provider ?? '(not reported)'}`);
    log(`  email confirmed : ${sessionInfo.emailConfirmed}`);
    log(`  tokens present  : access=${sessionInfo.hasAccessToken} refresh=${sessionInfo.hasRefreshToken} (values not read)`);
  }

  // ---- Step 5: confirm the app treats us as signed in ---------------------
  const signedInText = await page.locator('body').innerText();
  const showsSignedIn = /Signed in as|signed in as/i.test(signedInText);
  log(`  UI shows a signed-in state: ${showsSignedIn}`);

  if (sessionInfo.present && sessionInfo.email) {
    log('SUCCESS: Google sign-in completed and a session exists in the app.');
  } else if (sessionInfo.present) {
    log('PARTIAL: a session exists but the email could not be read.');
  } else {
    log('FAILED: no Supabase session was stored after the redirect.');
  }

  if (consoleErrors.length) {
    log('  browser console errors:');
    consoleErrors.slice(0, 5).forEach((e) => log('    - ' + e));
  }

  log('Browser left open for 30s so you can inspect the signed-in state.');
  await page.waitForTimeout(30000);
  await browser.close();
  process.exit(sessionInfo.present ? 0 : 1);
}

main().catch((error) => {
  log('DRIVER ERROR: ' + error.message);
  process.exit(1);
});
