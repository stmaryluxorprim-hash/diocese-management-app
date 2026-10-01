'use client';

// ---------- إدارة الأفراد → «تسجيل» — add an enrollment of ANY kind ----------
// migration 20261005120000. The person already exists (one code, one
// password); the owner picks WHAT he is being registered as:
//   • كمخدوم  — one or more classes → owner_bulk_enroll (child rows with
//               their own attendance / points counters)
//   • كخادم   — role + places → POST /api/servants/create with the person's
//               code (admin_add_servant binds the Auth account to THIS person;
//               the password = the person's existing one, or the typed one
//               when he has none yet — 20261003120000 rule)
//   • ككاهن   — church + title → owner_add_priest_for_person (approved at
//               once; the trigger adopts the person's password)
// Any kind may be added AGAIN (20261006120000): more classes for a served
// child, more places for an existing servant account
// (owner_add_servant_places — same account, same password, places appended).
// Only the priest kind is one per person (one church) — manage it from
// إدارة الكهنة.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, User, ShieldCheck, Cross, AlertTriangle, Check, KeyRound, Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { ModalFrame } from '@/components/PersonDataModals';
import ScopePicker, { clampScope, type ScopeDepth } from '@/components/ScopePicker';
import { scopeKey } from '@/lib/types';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import {
  bulkEnroll, addPriestForPerson, addServantPlaces, ownerPersonsError, ENROLLMENT_KIND_LABELS, personKinds,
  type OwnerPersonRow, type EnrollmentKind,
} from '@/lib/owner-persons';
import {
  ROLE_LABELS, ADD_SERVANT_ERROR_LABELS, DEFAULT_PASSWORD,
  type Church, type Service, type ClassRoom, type ScopeRef, type AppRole, type AddServantInput, type AddServantOutcome,
} from '@/lib/types';

interface Lookups { churches: Church[]; services: Service[]; classes: ClassRoom[] }

const PRIEST_TITLES = ['القس', 'القمص', 'الأب', 'الراهب القس', 'نيافة الأنبا'];
const roleDepth = (r: AppRole): ScopeDepth => r === 'church_manager' ? 'church' : r === 'service_manager' ? 'service' : 'class';

const KIND_META: Record<EnrollmentKind, { icon: typeof User; tone: string; active: string; hint: string }> = {
  child:   { icon: User,        tone: 'bg-primary-50 text-primary-700',  active: 'bg-primary-600 text-white ring-primary-300',  hint: 'تسجيل في فصل أو أكثر — لكل فصل حضوره ونقاطه' },
  servant: { icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700',  active: 'bg-emerald-600 text-white ring-emerald-300',  hint: 'حساب خادم معتمد فورًا — يدخل بالكود وكلمة مرور الشخص نفسها' },
  priest:  { icon: Cross,       tone: 'bg-violet-50 text-violet-700',    active: 'bg-violet-600 text-white ring-violet-300',    hint: 'حساب كاهن معتمد فورًا مرتبط بكنيسة واحدة' },
};

export default function AddEnrollmentModal({ row, lookups, onDone, onClose }: {
  row: OwnerPersonRow; lookups: Lookups; onDone: (msg: string) => void; onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const { profile } = useAuth();
  const { profiles: permissionProfiles } = usePermissions();
  const held = personKinds(row);
  const [kind, setKind] = useState<EnrollmentKind>('child');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // child
  const [classScopes, setClassScopes] = useState<ScopeRef[]>([]);
  const pickLookups = useMemo(() => {
    const inIds = new Set(row.enrollments.map((e) => e.class_id));
    return { ...lookups, classes: lookups.classes.filter((c) => !inIds.has(c.id)) };
  }, [row, lookups]);

  // servant — when he already has an account we only APPEND places to it
  const existingServant = row.servant;
  const heldServantKeys = useMemo(() => new Set(existingServant
    ? [{ church_id: existingServant.church_id ?? '', service_id: existingServant.service_id, class_id: existingServant.class_id }, ...existingServant.scopes]
      .filter((s) => s.church_id).map((s) => scopeKey(s as ScopeRef))
    : []), [existingServant]);
  const [role, setRole] = useState<AppRole>(existingServant?.role ?? 'class_servant');
  const [servantScopes, setServantScopes] = useState<ScopeRef[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const depth = roleDepth(role);
  const onRole = (r: AppRole) => { setRole(r); setServantScopes((l) => l.map((s) => clampScope(s, roleDepth(r)))); };

  // priest
  const [priestChurch, setPriestChurch] = useState(lookups.churches.length === 1 ? lookups.churches[0].id : '');
  const [title, setTitle] = useState('');

  // password — only used when the person has NO password yet (servant / priest)
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [showPw, setShowPw] = useState(false);
  const needsPassword = !row.has_password && kind !== 'child';

  const disabledKind = (k: EnrollmentKind) => k === 'priest' && held.includes(k);

  const run = async () => {
    setError('');
    if (needsPassword && password.length < 6) return setError('كلمة المرور 6 أحرف على الأقل');
    setBusy(true);
    try {
      if (kind === 'child') {
        if (classScopes.length === 0) { setBusy(false); return setError('اختر فصلًا واحدًا على الأقل'); }
        const r = await bulkEnroll(supabase, [row.id], classScopes);
        onDone(`تم تسجيل «${row.name}» كمخدوم في ${r.added} ${r.added === 1 ? 'فصل' : 'فصول'}${r.skipped ? ` — ${r.skipped} كانت موجودة` : ''}`);
      } else if (kind === 'servant' && existingServant) {
        // another place for the SAME servant account — nothing else changes
        if (servantScopes.length === 0) { setBusy(false); return setError('اختر مكان الخدمة الجديد (الكنيسة على الأقل)'); }
        const fresh = servantScopes.map((s) => clampScope(s, depth)).filter((s) => !heldServantKeys.has(scopeKey(s)));
        if (fresh.length === 0) { setBusy(false); return setError('كل الأماكن المختارة لديه بالفعل'); }
        const r = await addServantPlaces(supabase, existingServant.id, fresh);
        const n = r.count ?? fresh.length;
        onDone(`تمت إضافة ${n} ${n === 1 ? 'مكان خدمة' : 'أماكن خدمة'} لحساب «${row.name}» كخادم${fresh.length < servantScopes.length ? ' — الباقي كان لديه' : ''}`);
      } else if (kind === 'servant') {
        if (servantScopes.length === 0) { setBusy(false); return setError('اختر مكان الخدمة (الكنيسة على الأقل)'); }
        const scopes = servantScopes.map((s) => clampScope(s, depth));
        const item: AddServantInput = {
          code: row.national_id, full_name: row.name, password: row.has_password ? 'unused-' + Date.now() : password,
          role, church_id: scopes[0].church_id, service_id: scopes[0].service_id, class_id: scopes[0].class_id, scopes,
          gender: row.gender, birthdate: row.birthdate, phone: row.phone, address: row.address, notes: row.notes, image_url: row.image_url,
          profile_ids: selectedProfiles,
        };
        const res = await fetch('/api/servants/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [item] }) });
        if (res.status === 503) throw new Error('not_configured');
        const body = await res.json().catch(() => ({})) as { results?: AddServantOutcome[]; error?: string };
        const out = body.results?.[0];
        if (!res.ok || !out) throw new Error(body.error ?? 'failed');
        if (!out.ok) throw new Error(ADD_SERVANT_ERROR_LABELS[out.error] ?? out.error);
        onDone(`تم تسجيل «${row.name}» كخادم (${ROLE_LABELS[role]})${out.password_reused || row.has_password ? ' — يدخل بكلمة مروره الحالية' : ` — كلمة المرور: ${password}`}`);
      } else {
        if (!priestChurch) { setBusy(false); return setError('اختر الكنيسة'); }
        await addPriestForPerson(supabase, row.id, priestChurch, title.trim() || null, row.has_password ? null : password);
        onDone(`تم تسجيل «${row.name}» ككاهن${title.trim() ? ` (${title.trim()})` : ''}${row.has_password ? ' — يدخل بكلمة مروره الحالية' : ` — كلمة المرور: ${password}`}`);
      }
      onClose();
    } catch (e) {
      const m = (e as Error).message ?? '';
      setError(m === 'not_configured' ? 'إضافة الخدام غير مفعّلة على الخادم (SUPABASE_SERVICE_ROLE_KEY)'
        : m === 'forbidden' ? 'ليس لديك صلاحية'
        : Object.values(ADD_SERVANT_ERROR_LABELS).includes(m) ? m
        : ownerPersonsError(e, m || 'تعذر التسجيل'));
    } finally {
      setBusy(false);
    }
  };

  const Icon = KIND_META[kind].icon;

  return (
    <ModalFrame title={`تسجيل ${row.name}`} icon={<Plus className="h-5 w-5 text-violet-600" />} onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">
        الشخص واحد بكود واحد وكلمة مرور واحدة — اختر <b>كيف</b> تريد تسجيله.
        {held.length > 0 && <> مسجّل حاليًا: <b>{held.map((k) => ENROLLMENT_KIND_LABELS[k].as).join(' · ')}</b>.</>}
      </p>

      {/* kind picker */}
      <div id="ae-kind" role="tablist" className="mb-3 grid grid-cols-3 gap-2">
        {(['child', 'servant', 'priest'] as EnrollmentKind[]).map((k) => {
          const KIcon = KIND_META[k].icon;
          const off = disabledKind(k);
          const on = kind === k;
          return (
            <button key={k} id={`ae-kind-${k}`} type="button" role="tab" aria-selected={on} disabled={off}
              onClick={() => { setKind(k); setError(''); }}
              className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-xs font-extrabold transition ring-2 ${
                on ? KIND_META[k].active : `${KIND_META[k].tone} ring-transparent`} ${off ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'}`}>
              <KIcon className="h-5 w-5" />
              {ENROLLMENT_KIND_LABELS[k].as}
              {off && <span className="text-[9px] font-bold opacity-80">مسجّل بالفعل</span>}
            </button>
          );
        })}
      </div>
      <p className="mb-3 flex items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {kind === 'servant' && existingServant
          ? `له حساب خادم بالفعل (${ROLE_LABELS[existingServant.role]}) — تُضاف الأماكن الجديدة إلى الحساب نفسه`
          : KIND_META[kind].hint}
      </p>

      {kind === 'child' && (
        <ScopePicker idPrefix="ae-child" title="الفصول" value={classScopes} onChange={setClassScopes} lookups={pickLookups}
          depth="class" requireLeaf primaryLabel={null} addLabel="إضافة فصل" emptyText="اختر الفصول التي يُسجَّل فيها" />
      )}

      {kind === 'servant' && (
        <div className="space-y-2">
          <div>
            <label htmlFor="ae-role" className="mb-1 block text-xs font-bold text-slate-500">الدور</label>
            <select id="ae-role" className="input-field" value={role} disabled={!!existingServant} onChange={(e) => onRole(e.target.value as AppRole)}>
              {(['church_manager', 'service_manager', 'class_servant'] as AppRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <ScopePicker idPrefix="ae-servant" title={existingServant ? 'أماكن خدمة جديدة' : 'أماكن الخدمة'} value={servantScopes} onChange={setServantScopes} lookups={lookups}
            depth={depth} primaryLabel={existingServant ? null : undefined} emptyText={existingServant ? 'اختر المكان الجديد الذي يُضاف إلى حسابه' : 'اختر مكان الخدمة'} />
          {!existingServant && permissionProfiles.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-2.5">
              <p className="mb-1.5 flex items-center gap-1 text-xs font-extrabold text-slate-500">
                <KeyRound className="h-3.5 w-3.5 text-primary-500" /> ملفات الصلاحيات <span className="font-normal">(اختياري)</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {permissionProfiles.map((pp) => {
                  const on = selectedProfiles.includes(pp.id);
                  return (
                    <button key={pp.id} type="button" aria-pressed={on}
                      onClick={() => setSelectedProfiles((s) => (on ? s.filter((x) => x !== pp.id) : [...s, pp.id]))}
                      className={`rounded-full px-3 py-1 text-xs font-bold transition ${on ? 'text-white shadow' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
                      style={on ? { backgroundColor: pp.color } : undefined}>
                      {pp.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {profile?.role !== 'owner' && (
            <p className="text-[11px] font-bold text-amber-700">إضافة الخدام للمالك أو مديري الكنائس / الخدمات فقط</p>
          )}
        </div>
      )}

      {kind === 'priest' && (
        <div className="space-y-2">
          <div>
            <label htmlFor="ae-priest-church" className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
            <select id="ae-priest-church" className="input-field" value={priestChurch} onChange={(e) => setPriestChurch(e.target.value)}>
              <option value="">اختر الكنيسة</option>
              {lookups.churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ae-priest-title" className="mb-1 block text-xs font-bold text-slate-500">اللقب</label>
            <input id="ae-priest-title" className="input-field" list="ae-priest-titles" placeholder="القس / القمص…" value={title} onChange={(e) => setTitle(e.target.value)} />
            <datalist id="ae-priest-titles">{PRIEST_TITLES.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
        </div>
      )}

      {/* password — only when the person has none yet (never for appending places) */}
      {kind !== 'child' && !(kind === 'servant' && existingServant) && (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px]">
          {row.has_password ? (
            <p className="flex items-center gap-1.5 font-bold text-emerald-700"><Check className="h-3.5 w-3.5" /> للشخص كلمة مرور بالفعل — سيدخل بها إلى هذا الحساب أيضًا</p>
          ) : (
            <>
              <label htmlFor="ae-password" className="mb-1 block font-bold text-slate-500">كلمة المرور (لكل حسابات الشخص)</label>
              <div className="flex gap-2">
                <input id="ae-password" type={showPw ? 'text' : 'password'} className="input-field flex-1 !py-1.5" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} />
                <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'إخفاء' : 'إظهار'} className="rounded-xl bg-white px-3 ring-1 ring-slate-200">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-slate-400">الافتراضية {DEFAULT_PASSWORD} — يمكنه تغييرها من حسابه لاحقًا</p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {kind === 'servant' && existingServant && (
        <p className="mt-3 text-xs text-slate-500">لتغيير دوره أو حذف مكان من أماكنه استخدم <Link href="/servants" className="font-bold text-emerald-700 underline">إدارة الخدام</Link>.</p>
      )}
      {kind === 'priest' && held.includes('priest') && (
        <p className="mt-3 text-xs text-slate-500">حساب الكاهن واحد لكل شخص (كنيسة واحدة) — عدّله من <Link href="/owner/priests" className="font-bold text-violet-700 underline">إدارة الكهنة</Link>.</p>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">إلغاء</button>
        <button id="ae-submit" type="button" onClick={run} disabled={busy || disabledKind(kind)}
          className="btn-primary flex flex-1 items-center justify-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {kind === 'servant' && existingServant ? 'إضافة الأماكن' : `تسجيل ${ENROLLMENT_KIND_LABELS[kind].as}`}
        </button>
      </div>
    </ModalFrame>
  );
}
