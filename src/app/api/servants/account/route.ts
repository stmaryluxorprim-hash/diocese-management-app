// POST /api/servants/account — manage a servant's LOGIN account
//   (إعادة تعيين كلمة المرور / تعديل الكود) — migration 0042 features.
//
// The browser cannot touch another user's Supabase Auth account, so both
// operations run here with the service role:
//
//   { action: 'reset_password', servant_id, password }
//       → auth.admin.updateUserById(password)
//   { action: 'change_code', servant_id, code }
//       → auth.admin.updateUserById(email = newcode@diocese.app)
//       → servant_enrollments.user_id = normalized code
//       → persons.national_id = code (the servant's identity row; also
//         re-keys his QR card, portal code and every mirror enrollment)
//   { action: 'realign', servant_id }                  (20261005120000)
//       → after owner_merge_persons: the Auth account is re-synced with the
//         person's FINAL code (login e-mail) and ONE password hash
//         (admin_servant_identity). Owner only.
//
// Who may call: an APPROVED owner / church manager / service manager whose
// scope covers the target servant (same rule as editing him in ServantsPanel:
// owner → anyone; church manager → his church; service manager → his service).
// 0043: ONLY a SUPERIOR may reset a password without knowing the old one.
// A servant changing HIS OWN password goes through Supabase Auth in the
// browser (old + new + confirm — EditProfileModal), never through here.
// OWN CODE: only the OWNER may change his own code (تعديل بياناتي) — nobody
// else can change the owner's code, and other servants get their code
// changed by a superior only.
//
// Env (server): SUPABASE_SERVICE_ROLE_KEY. Without it → 503 «not configured».

import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient as createSessionClient } from '@/lib/supabase/server';
import { codeToUserId, userIdToEmail, SERVANTS_TABLE } from '@/lib/types';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Actor = { id: string; role: string; status: string; church_id: string | null; service_id: string | null };
type Target = { id: string; role: string; person_id: string | null; church_id: string | null; service_id: string | null; user_id: string };

type Action = 'reset_password' | 'change_code' | 'realign';

function canManage(actor: Actor, target: Target, action: Action): boolean {
  if (action === 'realign') return actor.role === 'owner';
  if (actor.id === target.id) {
    // self: own password = old + new in the browser, never here.
    // own code: the OWNER only.
    return action === 'change_code' && actor.role === 'owner';
  }
  if (actor.role === 'owner') return true;
  if (target.role === 'owner') return false;
  if (actor.role === 'church_manager') return !!actor.church_id && target.church_id === actor.church_id;
  if (actor.role === 'service_manager') return !!actor.service_id && target.service_id === actor.service_id;
  return false;
}

export async function POST(req: NextRequest) {
  const session = createSessionClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const action = body.action;
  const servantId = typeof body.servant_id === 'string' && UUID_RE.test(body.servant_id) ? body.servant_id : null;
  if (!servantId) return NextResponse.json({ error: 'servant_required' }, { status: 400 });
  if (action !== 'reset_password' && action !== 'change_code' && action !== 'realign') return NextResponse.json({ error: 'bad_action' }, { status: 400 });

  const [{ data: actor }, { data: target }] = await Promise.all([
    admin.from(SERVANTS_TABLE).select('id, role, status, church_id, service_id').eq('id', user.id).maybeSingle(),
    admin.from(SERVANTS_TABLE).select('id, role, person_id, church_id, service_id, user_id').eq('id', servantId).maybeSingle(),
  ]);
  if (!actor || actor.status !== 'approved') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canManage(actor as Actor, target as Target, action)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // ---------- realign (after a merge) ----------
  if (action === 'realign') {
    const { data: idn, error: idErr } = await admin.rpc('admin_servant_identity', { p_servant: servantId });
    const ident = idn as { code: string; user_id: string; password_hash: string | null } | null;
    if (idErr || !ident?.user_id) return NextResponse.json({ error: 'failed', detail: idErr?.message ?? 'no_identity' }, { status: 500 });
    const attrs: Record<string, unknown> = { email: userIdToEmail(ident.user_id), email_confirm: true, user_metadata: { code: ident.code } };
    if (ident.password_hash && ident.password_hash.length > 20) attrs.password_hash = ident.password_hash;
    const { error } = await admin.auth.admin.updateUserById(servantId, attrs);
    if (error) {
      const m = error.message.toLowerCase();
      const taken = m.includes('already') || m.includes('exists') || m.includes('registered');
      return NextResponse.json({ error: taken ? 'code_taken' : 'failed', detail: error.message }, { status: taken ? 409 : 500 });
    }
    return NextResponse.json({ ok: true, user_id: ident.user_id, code: ident.code });
  }

  // ---------- reset password ----------
  if (action === 'reset_password') {
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 6) return NextResponse.json({ error: 'weak_password' }, { status: 400 });
    const { error } = await admin.auth.admin.updateUserById(servantId, { password });
    if (error) return NextResponse.json({ error: 'failed', detail: error.message }, { status: 500 });
    // 20261003120000: ONE password per person — the child / priest side follows
    await admin.rpc('admin_mirror_servant_password', { p_servant: servantId, p_password: password, p_source: 'admin' });
    return NextResponse.json({ ok: true });
  }

  // ---------- change code ----------
  const code = typeof body.code === 'string' ? body.code.trim().slice(0, 80) : '';
  const userId = codeToUserId(code);
  if (!code || !userId) return NextResponse.json({ error: 'code_required' }, { status: 400 });
  if (userId === target.user_id && code === (await currentCode(admin, target as Target))) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // uniqueness: another servant with the same login, another person with the
  // same code, or a FAMILY that owns the code (20260930120000 — one code
  // space: a person code can never equal a family code). Checked up-front
  // because the auth e-mail is changed before the persons row.
  const [{ data: dupServant }, { data: dupPerson }, { data: dupFamily }] = await Promise.all([
    admin.from(SERVANTS_TABLE).select('id').eq('user_id', userId).neq('id', servantId).maybeSingle(),
    admin.from('persons').select('id').eq('national_id', code).maybeSingle(),
    admin.from('families').select('id').eq('code', code).maybeSingle(),
  ]);
  if (dupFamily) return NextResponse.json({ error: 'code_is_family' }, { status: 409 });
  if (dupServant) return NextResponse.json({ error: 'code_taken' }, { status: 409 });
  if (dupPerson && dupPerson.id !== target.person_id) return NextResponse.json({ error: 'code_taken' }, { status: 409 });

  // 1) auth e-mail (login name)
  const { error: authErr } = await admin.auth.admin.updateUserById(servantId, {
    email: userIdToEmail(userId),
    email_confirm: true,
    user_metadata: { code },
  });
  if (authErr) {
    const m = authErr.message.toLowerCase();
    const taken = m.includes('already') || m.includes('exists') || m.includes('registered');
    return NextResponse.json({ error: taken ? 'code_taken' : 'failed', detail: authErr.message }, { status: taken ? 409 : 500 });
  }
  // 2) servant row
  const { error: seErr } = await admin.from(SERVANTS_TABLE).update({ user_id: userId }).eq('id', servantId);
  if (seErr) return NextResponse.json({ error: 'failed', detail: seErr.message }, { status: 500 });
  // 3) identity row (persons.national_id)
  if (target.person_id) {
    const { error: pErr } = await admin.from('persons').update({ national_id: code }).eq('id', target.person_id);
    if (pErr) {
      const isFamily = /code_is_family/i.test(pErr.message ?? '');
      return NextResponse.json(
        { error: isFamily ? 'code_is_family' : pErr.code === '23505' ? 'code_taken' : 'failed', detail: pErr.message },
        { status: pErr.code === '23505' ? 409 : 500 },
      );
    }
  }
  return NextResponse.json({ ok: true, user_id: userId, code });
}

async function currentCode(admin: ReturnType<typeof adminClient>, target: Target): Promise<string | null> {
  if (!admin || !target.person_id) return null;
  const { data } = await admin.from('persons').select('national_id').eq('id', target.person_id).maybeSingle();
  return (data?.national_id as string | undefined) ?? null;
}
