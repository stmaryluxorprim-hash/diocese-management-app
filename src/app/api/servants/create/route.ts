// POST /api/servants/create — add servants DIRECTLY (إضافة خدام — فردي / جماعي)
//
// The browser cannot create another user's login account (Supabase Auth
// admin API needs the service role), so the ADD flow goes through this
// server route:
//
//   1. the caller's session (cookies) → actor id. Must be an APPROVED
//      owner / church manager / service manager (re-checked in SQL too).
//   2. for every item: auth.admin.createUser (login = the code, e-mail
//      confirmed, password as typed / generated) → account id
//   3. RPC admin_add_servant(actor, account, …) — validates the actor's
//      rights + scope, upserts the person by code, creates the APPROVED
//      servant enrollment and grants the permission profiles.
//   4. if the RPC fails the auth account is deleted again (no orphans).
//
// Body: { items: AddServantInput[] }   (1 item = single add, n = bulk)
// Response: { results: AddServantOutcome[] } — one per item, same order,
// never throws for a single bad row (bulk keeps going).
//
// Env (server): SUPABASE_SERVICE_ROLE_KEY (same key the notifications
// dispatcher uses). Without it the route answers 503 «not configured».

import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient as createSessionClient } from '@/lib/supabase/server';
import { codeToUserId, userIdToEmail, SERVANTS_TABLE } from '@/lib/types';
import type { AddServantInput, AddServantOutcome, AddServantError, AppRole } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_ITEMS = 200;
const ROLES: AppRole[] = ['church_manager', 'service_manager', 'class_servant'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Map a SQL / auth error to a stable machine code the UI translates. */
function errorCode(message: string): AddServantError {
  const m = message.toLowerCase();
  if (m.includes('code_is_family')) return 'code_is_family';
  if (m.includes('code_taken') || m.includes('already been registered') || m.includes('already registered') || m.includes('already exists')) return 'code_taken';
  if (m.includes('already_registered')) return 'already_registered';
  if (m.includes('not_allowed') || m.includes('scope_not_allowed') || m.includes('role_not_allowed')) return 'not_allowed';
  if (m.includes('church_required') || m.includes('church_not_found')) return 'church_required';
  if (m.includes('service_not_in_church') || m.includes('class_not_in_service')) return 'invalid_scope';
  if (m.includes('code_required')) return 'code_required';
  if (m.includes('name_required')) return 'name_required';
  if (m.includes('invalid_gender')) return 'invalid_gender';
  if (m.includes('password')) return 'weak_password';
  return 'failed';
}

const str = (v: unknown, max = 500): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

function sanitize(raw: unknown): { ok: true; item: AddServantInput } | { ok: false; error: AddServantError } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'failed' };
  const r = raw as Record<string, unknown>;
  const code = str(r.code, 80);
  const full_name = str(r.full_name, 160);
  const password = typeof r.password === 'string' ? r.password : '';
  const role = ROLES.includes(r.role as AppRole) ? (r.role as AppRole) : 'class_servant';
  const church_id = uuid(r.church_id);
  if (!code) return { ok: false, error: 'code_required' };
  if (!full_name) return { ok: false, error: 'name_required' };
  if (!church_id) return { ok: false, error: 'church_required' };
  if (password.length < 6) return { ok: false, error: 'weak_password' };
  const gender = r.gender === 'male' || r.gender === 'female' ? r.gender : null;
  const birthdate = typeof r.birthdate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.birthdate) ? r.birthdate : null;
  const profiles = Array.isArray(r.profile_ids) ? (r.profile_ids.map(uuid).filter(Boolean) as string[]) : [];
  // 0045: every place (primary first). Rows without a church are dropped; max 50.
  const scopes = Array.isArray(r.scopes)
    ? (r.scopes as unknown[]).slice(0, 50).flatMap((x) => {
        if (!x || typeof x !== 'object') return [];
        const o = x as Record<string, unknown>;
        const c = uuid(o.church_id);
        return c ? [{ church_id: c, service_id: uuid(o.service_id), class_id: uuid(o.class_id) }] : [];
      })
    : [];
  return {
    ok: true,
    item: {
      code, full_name, password, role, church_id,
      service_id: uuid(r.service_id),
      class_id: uuid(r.class_id),
      scopes: scopes.length ? scopes : undefined,
      gender, birthdate,
      phone: str(r.phone, 20),
      address: str(r.address),
      notes: str(r.notes, 2000),
      image_url: str(r.image_url, 1000),
      profile_ids: profiles,
    },
  };
}

export async function POST(req: NextRequest) {
  // ---- 1. who is calling? ----
  const session = createSessionClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const { data: actor } = await admin
    .from(SERVANTS_TABLE)
    .select('id, role, status')
    .eq('id', user.id)
    .maybeSingle();
  if (!actor || actor.status !== 'approved' || !['owner', 'church_manager', 'service_manager'].includes(actor.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // ---- 2. body ----
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const items = Array.isArray((body as { items?: unknown })?.items) ? ((body as { items: unknown[] }).items) : null;
  if (!items || items.length === 0) return NextResponse.json({ error: 'no_items' }, { status: 400 });
  if (items.length > MAX_ITEMS) return NextResponse.json({ error: 'too_many', max: MAX_ITEMS }, { status: 400 });

  // ---- 3. one by one (bulk keeps going on a bad row) ----
  const results: AddServantOutcome[] = [];
  const seenLogins = new Set<string>();

  for (const raw of items) {
    const s = sanitize(raw);
    if (!s.ok) { results.push({ ok: false, error: s.error }); continue; }
    const it = s.item;
    const userId = codeToUserId(it.code);
    if (!userId) { results.push({ ok: false, error: 'code_required' }); continue; }
    if (seenLogins.has(userId)) { results.push({ ok: false, error: 'duplicate_in_batch', user_id: userId }); continue; }
    seenLogins.add(userId);

    // 3a. login account
    // 20261003120000: ONE password per person — when the code already belongs
    // to a person with a password (a child / priest), the servant account is
    // created with the SAME bcrypt hash and the typed password is ignored.
    const { data: existingHash } = await admin.rpc('admin_person_password_hash', { p_code: it.code });
    const reusePassword = typeof existingHash === 'string' && existingHash.length > 20;
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: userIdToEmail(userId),
      ...(reusePassword ? { password_hash: existingHash as string } : { password: it.password }),
      email_confirm: true,
      user_metadata: { code: it.code, full_name: it.full_name, added_by: actor.id },
    });
    if (authErr || !created?.user) {
      results.push({ ok: false, error: errorCode(authErr?.message ?? ''), user_id: userId, detail: authErr?.message });
      continue;
    }
    const accountId = created.user.id;

    // 3b. person + approved enrollment + profiles
    const { data, error: rpcErr } = await admin.rpc('admin_add_servant', {
      p_actor: actor.id,
      p_account: accountId,
      p_code: it.code,
      p_full_name: it.full_name,
      p_role: it.role,
      p_church: it.church_id,
      p_service: it.service_id,
      p_class: it.class_id,
      p_gender: it.gender,
      p_birthdate: it.birthdate,
      p_phone: it.phone,
      p_address: it.address,
      p_notes: it.notes,
      p_image_url: it.image_url,
      p_profiles: it.profile_ids,
      // 0045: the places (null → the RPC falls back to p_church/p_service/p_class)
      p_scopes: it.scopes && it.scopes.length ? it.scopes : null,
    });

    if (rpcErr) {
      // 3c. no orphan login accounts
      await admin.auth.admin.deleteUser(accountId).catch(() => {});
      results.push({ ok: false, error: errorCode(rpcErr.message), user_id: userId, detail: rpcErr.message });
      continue;
    }

    // 20261003120000: a NEW password becomes the person's one password
    if (!reusePassword) {
      await admin.rpc('admin_mirror_servant_password', { p_servant: accountId, p_password: it.password, p_source: 'admin' });
    }

    const r = (data ?? {}) as Record<string, unknown>;
    results.push({
      ok: true,
      servant_id: accountId,
      password_reused: reusePassword,
      person_id: (r.person_id as string) ?? null,
      person_created: !!r.person_created,
      national_id: (r.national_id as string) ?? it.code,
      user_id: (r.user_id as string) ?? userId,
      profiles_granted: Number(r.profiles_granted ?? 0),
    });
  }

  return NextResponse.json({ results });
}
