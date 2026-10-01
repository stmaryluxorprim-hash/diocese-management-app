// POST /api/account/sync-password — a child / priest changed THE password of
// the person in his portal (migration 20261003120000: one password per
// person). The database already holds the new hash; this route pushes the
// same password into the person's SERVANT Supabase Auth account (if he has
// one) so «one code, one password» stays true for the servant login as well.
//
// Body: { kind: 'child' | 'priest', token, password }
//   → the DB re-checks that `password` IS the person's current password
//     (account_servant_for_sync, service role) → auth.admin.updateUserById.
// Never fails the caller's flow: a missing service key answers 503 and the
// portals just show a hint.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

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

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const kind = body.kind === 'child' || body.kind === 'priest' ? body.kind : null;
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!kind || token.length < 20 || password.length < 6) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { data, error } = await admin.rpc('account_servant_for_sync', { p_kind: kind, p_token: token, p_password: password });
  if (error) {
    const m = error.message ?? '';
    const code = m.includes('wrong_password') ? 'wrong_password' : m.includes('session_expired') ? 'session_expired' : 'failed';
    return NextResponse.json({ error: code, detail: m }, { status: code === 'failed' ? 500 : 403 });
  }
  const r = data as { person_id: string; servant_id: string | null };
  if (!r.servant_id) return NextResponse.json({ ok: true, servant: false });

  const { error: upErr } = await admin.auth.admin.updateUserById(r.servant_id, { password });
  if (upErr) return NextResponse.json({ error: 'failed', detail: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, servant: true });
}
