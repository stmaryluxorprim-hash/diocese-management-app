// POST /api/account/switch — تبديل الحساب إلى حساب الخادم (migration 20261003120000)
//
// The browser already proved who it is to the database (child / priest
// session) and received a ONE-TIME TICKET from `account_switch`. The DB cannot
// mint a Supabase Auth session, so this route — with the service role —
//   1. redeems the ticket (`account_switch_redeem`, single use, 2 minutes)
//   2. generates a magic link for the servant's login e-mail
//      (auth.admin.generateLink → hashed_token)
//   3. returns the token hash; the browser calls `auth.verifyOtp({ token_hash,
//      type: 'magiclink' })` and is signed in as the servant — no password,
//      no e-mail is ever sent.
//
// Body: { ticket }  →  { token_hash }
// Env (server): SUPABASE_SERVICE_ROLE_KEY. Without it → 503 «not_configured».
//
// 20261019120000 (login rush): this route used to make TWO Auth-admin calls
// per servant login (getUserById + generateLink). The Auth server is
// rate-limited per IP — and from here every request comes from the SAME
// server IP — so 60 servants signing in together tripped it. Now:
//   • ONE Auth call: generateLink for the derived e-mail; getUserById runs
//     only if that fails (an account whose e-mail was changed by hand).
//   • 429 / 5xx from Auth are passed through as `switch_busy` + Retry-After
//     so the browser backs off and retries (withLoginRetry) instead of failing.
//   • the ticket is PEEKED first (account_switch_peek) and consumed only
//     after the link is minted — a transient Auth failure leaves it valid
//     for the retry (it still expires in 2 minutes). An older database
//     without the peek RPC falls back to the one-shot redeem.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { userIdToEmail } from '@/lib/types';

export const dynamic = 'force-dynamic';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(req: NextRequest) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  let body: { ticket?: unknown };
  try { body = (await req.json()) as { ticket?: unknown }; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : '';
  if (ticket.length < 20) return NextResponse.json({ error: 'invalid_ticket' }, { status: 400 });

  type Redeemed = { servant_id: string; user_id: string; remember: boolean };
  const dbError = (m: string) => {
    const code = m.includes('invalid_ticket') ? 'invalid_ticket' : m.includes('account_stopped') ? 'account_stopped' : 'failed';
    return NextResponse.json({ error: code, detail: m }, { status: code === 'failed' ? 500 : 400 });
  };

  // 1. peek: who is behind the ticket (does NOT consume it)
  let r: Redeemed | null = null;
  let redeemed = false;
  const peek = await admin.rpc('account_switch_peek', { p_ticket: ticket });
  if (peek.error) {
    const m = peek.error.message ?? '';
    const missing = /account_switch_peek|does not exist|PGRST202|schema cache/i.test(m);
    if (!missing) return dbError(m);
    // older database → one-shot redeem (previous behaviour)
    const red = await admin.rpc('account_switch_redeem', { p_ticket: ticket });
    if (red.error) return dbError(red.error.message ?? '');
    r = red.data as Redeemed;
    redeemed = true;
  } else {
    r = peek.data as Redeemed;
  }

  // 2. ONE Auth call: the derived login e-mail; the authoritative one is
  //    looked up only when Auth does not know the derived one
  const derived = userIdToEmail(r.user_id);
  let link = await admin.auth.admin.generateLink({ type: 'magiclink', email: derived });
  if (link.error && !isTransient(link.error)) {
    const { data: u } = await admin.auth.admin.getUserById(r.servant_id);
    if (u?.user?.email && u.user.email !== derived) {
      link = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
    }
  }
  if (link.error || !link.data?.properties?.hashed_token) {
    if (isTransient(link.error)) {
      // Auth is rate-limiting / unavailable — the browser backs off and
      // retries; the ticket is still unredeemed (peek path)
      const status = authStatus(link.error) === 429 ? 429 : 503;
      return NextResponse.json({ error: 'switch_busy', retry_after: 2, detail: link.error?.message }, { status, headers: { 'Retry-After': '2' } });
    }
    return NextResponse.json({ error: 'failed', detail: link.error?.message ?? 'no_token' }, { status: 500 });
  }

  // 3. consume the ticket now that the link exists (sets the active place)
  if (!redeemed) {
    const red = await admin.rpc('account_switch_redeem', { p_ticket: ticket });
    if (red.error) return dbError(red.error.message ?? '');
  }
  return NextResponse.json({ token_hash: link.data.properties.hashed_token, remember: r.remember });
}

function authStatus(err: unknown): number {
  const e = err as { status?: unknown; code?: unknown } | null;
  const s = typeof e?.status === 'number' ? e.status : Number(e?.code);
  return Number.isFinite(s) ? s : 0;
}
function isTransient(err: unknown): boolean {
  if (!err) return false;
  const s = authStatus(err);
  if (s === 429 || (s >= 500 && s < 600)) return true;
  const m = String((err as { message?: string }).message ?? '').toLowerCase();
  return /rate limit|too many|timeout|timed out|fetch failed|econnreset|unavailable|gateway/.test(m);
}
