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

  const { data, error } = await admin.rpc('account_switch_redeem', { p_ticket: ticket });
  if (error) {
    const m = error.message ?? '';
    const code = m.includes('invalid_ticket') ? 'invalid_ticket' : m.includes('account_stopped') ? 'account_stopped' : 'failed';
    return NextResponse.json({ error: code, detail: m }, { status: code === 'failed' ? 500 : 400 });
  }
  const r = data as { servant_id: string; user_id: string; remember: boolean };

  // the servant's login e-mail — read from Auth (authoritative) and fall back
  // to the derived one so an account whose e-mail was changed by hand works too
  const { data: u } = await admin.auth.admin.getUserById(r.servant_id);
  const email = u?.user?.email ?? userIdToEmail(r.user_id);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: 'failed', detail: linkErr?.message ?? 'no_token' }, { status: 500 });
  }
  return NextResponse.json({ token_hash: link.properties.hashed_token, remember: r.remember });
}
