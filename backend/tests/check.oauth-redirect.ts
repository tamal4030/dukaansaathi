/**
 * Probes the Supabase authorize endpoint to confirm:
 *   1. the Google provider is configured with a usable client id, and
 *   2. the app's redirect_to is on the allow-list.
 *
 * No secrets are printed: only the HTTP status, the redirect host, and whether
 * expected query parameters are present.
 */
import { readFileSync } from 'node:fs';

const REDIRECTS = [
  'http://localhost:5173/auth/customer',
  'http://127.0.0.1:5173/auth/customer',
];

function loadEnv() {
  const env = {};
  for (const line of readFileSync('../frontend/.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

function describe(location) {
  try {
    const u = new URL(location);
    const params = u.searchParams;
    return {
      host: u.host,
      path: u.pathname,
      hasClientId: params.has('client_id'),
      clientIdLooksPopulated: (params.get('client_id') || '').length > 10,
      redirectUriHost: (() => {
        const r = params.get('redirect_uri');
        return r ? new URL(r).host : null;
      })(),
      redirectUriPath: (() => {
        const r = params.get('redirect_uri');
        return r ? new URL(r).pathname : null;
      })(),
      scope: params.get('scope'),
      responseType: params.get('response_type'),
      hasState: params.has('state'),
      hasCodeChallenge: params.has('code_challenge'),
    };
  } catch {
    return { raw: location.slice(0, 120) };
  }
}

async function main() {
  const env = loadEnv();
  const url = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.VITE_SUPABASE_ANON_KEY || '';

  for (const redirectTo of REDIRECTS) {
    const endpoint =
      `${url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
    const response = await fetch(endpoint, {
      headers: { apikey: key },
      redirect: 'manual',
    });

    console.log('---');
    console.log('redirect_to:', redirectTo);
    console.log('HTTP status:', response.status);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || '';
      const info = describe(location);
      console.log('RESULT: redirect issued (allow-list OK)');
      console.log('  redirect host      :', info.host);
      console.log('  client_id present  :', info.hasClientId, '(populated:', info.clientIdLooksPopulated, ')');
      console.log('  redirect_uri host  :', info.redirectUriHost);
      console.log('  redirect_uri path  :', info.redirectUriPath);
      console.log('  scope              :', info.scope);
      console.log('  response_type      :', info.responseType);
      console.log('  PKCE challenge     :', info.hasCodeChallenge);
      console.log('  state present      :', info.hasState);
    } else {
      const body = await response.text();
      console.log('RESULT: rejected');
      console.log('  body (truncated):', body.slice(0, 300));
    }
  }
}

main().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});
