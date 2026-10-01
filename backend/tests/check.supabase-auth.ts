/**
 * Reads Supabase's PUBLIC auth settings to confirm which sign-in providers are
 * enabled. Same endpoint the browser SDK uses; exposes no secrets.
 */
import { readFileSync } from 'node:fs';

async function main() {
  const env = {};
  for (const line of readFileSync('../frontend/.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }

  const url = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.VITE_SUPABASE_ANON_KEY || '';
  console.log('Supabase host:', url.replace('https://', ''));
  console.log('Publishable key present:', Boolean(key), '| length:', key.length);
  console.log('');

  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  console.log('GET /auth/v1/settings ->', response.status);

  if (!response.ok) {
    console.log('body (truncated):', (await response.text()).slice(0, 300));
    return;
  }

  const settings = await response.json();
  const ext = settings.external || {};
  console.log('');
  console.log('=== Sign-in providers ===');
  for (const name of Object.keys(ext).sort()) {
    console.log('  ' + name.padEnd(12) + ' ' + ext[name]);
  }
  console.log('');
  console.log('GOOGLE ENABLED:', ext.google === true);
  console.log('EMAIL ENABLED :', ext.email === true);
  console.log('');
  console.log('=== Other flags ===');
  for (const k of ['disable_signup', 'mailer_autoconfirm', 'external_email_enabled', 'external_phone_enabled']) {
    if (k in settings) console.log('  ' + k.padEnd(24) + ' ' + settings[k]);
  }
}

main().catch((e) => {
  console.error('check failed:', e.message);
  process.exit(1);
});
