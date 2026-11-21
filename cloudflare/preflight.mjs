#!/usr/bin/env node
// Preflight for `npm run cf:build` (Cloudflare Workers Builds / local).
//
// NEXT_PUBLIC_* variables are inlined into the bundle by `next build`, so
// they must exist in the BUILD environment. When they are missing the Next
// build fails ~2 minutes later with a cryptic prerender error on all 77
// pages ("@supabase/ssr: Your project's URL and API key are required…").
// Fail fast here with an actionable message instead.
//
// Cloudflare dashboard → Workers & Pages → <worker> → Settings → Build →
// "Variables and secrets" (these are the BUILD variables — different from
// the runtime "Variables and Secrets" section, which is also needed).
import { existsSync, readFileSync } from 'node:fs';

// Mirror Next's .env loading order so a local `.env.local` also satisfies the check.
for (const f of ['.env.production.local', '.env.local', '.env.production', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

// Supabase URL / anon key are now read at RUNTIME (SUPABASE_URL, SUPABASE_ANON_KEY —
// set them as runtime Secrets, no rebuild needed to change them), so the build
// no longer requires them. Legacy NEXT_PUBLIC_SUPABASE_* names still work.
const RECOMMENDED = ['NEXT_PUBLIC_VAPID_PUBLIC_KEY'];
const missingRec = RECOMMENDED.filter((k) => !(process.env[k] ?? '').trim());

if (missingRec.length) {
  console.warn(`\n[cf:build] ⚠ optional build variable(s) not set: ${missingRec.join(', ')} (push notifications will use the runtime fallback /api/notifications/vapid)\n`);
}

const hasBuildSupabase =
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
if (!hasBuildSupabase) {
  console.log(`[cf:build] ℹ Supabase variables not present at build time — fine.
          Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY as RUNTIME
          Secrets (Workers → Settings → Variables and Secrets) before the app is used.`);
} else {
  console.log('[cf:build] ✓ build variables present');
}
