'use client';

// ---------- وحدة المالك → الكهنة (owner only) ----------
// Tabs: الكهنة (list · edit church / title / status / reminder · password ·
// delete) · الطلبات (pending signups → approve with church / title or reject;
// history) · إضافة (add a priest directly — approved right away).
// Migration 20260927120000 — every write goes through owner_* RPCs.
// 20261004120000 — tab «دعوة»: priest signup is invite-only (signup_invites).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Cross, Users, Inbox, UserPlus, Ticket, Loader2, Check, X, Pencil, Trash2, KeyRound, Ban, Play, Phone, Search, Clock } from 'lucide-react';
import AppShell from '@/components/AppShell';
import { OwnerGate } from '@/components/ModuleGate';
import ResetPasswordSection from '@/components/ResetPasswordSection';
import SignupInvitePanel from '@/components/SignupInvitePanel';
import { PersonAvatar } from '@/components/CallFeedback';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { cachedLookup } from '@/lib/queries';
import { PHONE_PREFIX, PHONE_LOCAL_LENGTH, type Church, type Gender } from '@/lib/types';
import {
  fetchOwnerPriests, fetchPriestRequests, reviewPriestRequest, ownerAddPriest, ownerUpdatePriest, ownerSetPriestPassword, ownerDeletePriest,
  priestErrorMessage, PRIEST_STATUS_LABELS, type OwnerPriest, type PriestRequest,
} from '@/lib/priest-portal';
import { fmtDateTime, fmtDay } from '@/components/child/ChildBits';

type Tab = 'list' | 'requests' | 'add' | 'invite';
const TITLES = ['القس', 'القمص', 'الأب', 'الراهب القس', 'نيافة الأنبا'];

export default function OwnerPriestsPage() {
  return (
    <AppShell>
      <OwnerGate>
        <Inner />
      </OwnerGate>
    </AppShell>
  );
}

function Inner() {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<Tab>('list');
  const [priests, setPriests] = useState<OwnerPriest[] | null>(null);
  const [requests, setRequests] = useState<PriestRequest[] | null>(null);
  const [churches, setChurches] = useState<Church[]>([]);
  const load = useCallback(async () => {
    const [p, r, c] = await Promise.all([fetchOwnerPriests(supabase).catch(() => []), fetchPriestRequests(supabase).catch(() => []), cachedLookup<Church>(supabase, 'churches')]);
    setPriests(p); setRequests(r); setChurches(c);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);
  useDebouncedRealtime(supabase, 'owner-priests', [{ table: 'priests' }, { table: 'priest_requests' }], load, { delayMs: 1200 });
  const pending = useMemo(() => (requests ?? []).filter((r) => r.status === 'pending'), [requests]);

  return (
    <>
      <section className="mb-4 flex items-center gap-2">
        <Link href="/owner" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100"><ArrowRight className="h-5 w-5" /></Link>
        <h2 className="flex items-center gap-2 text-lg font-extrabold"><Cross className="h-5 w-5 text-violet-600" /> الكهنة</h2>
      </section>
      <p className="mb-4 rounded-2xl bg-violet-50 px-4 py-3 text-xs font-bold text-violet-800">
        الكاهن يسجّل من رابط دعوة يولّده المالك من تبويب «دعوة»، والمالك وحده يوافق ويعدّل ويوقف. لكل كاهن كنيسة واحدة، وفي بوابته وحدتا «المعترفين» و«الافتقاد».
      </p>
      <div role="tablist" className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
        {([['list', 'الكهنة', Users, priests?.length], ['requests', 'الطلبات', Inbox, pending.length], ['add', 'إضافة', UserPlus, undefined], ['invite', 'دعوة', Ticket, undefined]] as const).map(([k, l, I, n]) => (
          <button key={k} id={`op-tab-${k}`} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold transition ${tab === k ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}>
            <I className="h-4 w-4" />{l}{n !== undefined && n > 0 && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${k === 'requests' ? 'bg-rose-500 text-white' : 'bg-slate-200 text-slate-600'}`}>{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'list' && <PriestsList priests={priests} churches={churches} onChanged={load} />}
      {tab === 'requests' && <RequestsPanel requests={requests} churches={churches} onChanged={load} />}
      {tab === 'add' && <AddPanel churches={churches} onAdded={() => { load(); setTab('list'); }} />}
      {tab === 'invite' && <SignupInvitePanel kind="priest" hideScope />}
    </>
  );
}

// ---------- الكهنة ----------
function PriestsList({ priests, churches, onChanged }: { priests: OwnerPriest[] | null; churches: Church[]; onChanged: () => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (priests ?? []).filter((p) => !t || p.person.name.toLowerCase().includes(t) || p.church_name.includes(t) || p.person.national_id.toLowerCase().includes(t));
  }, [priests, q]);
  if (priests === null) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>;
  return (
    <>
      <div className="relative mb-3">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input-field pr-9" placeholder="بحث بالاسم · الكنيسة · الكود" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 ? <div className="card py-10 text-center text-sm font-bold text-slate-400">لا كهنة بعد</div>
        : <ul className="space-y-2">{list.map((p) => <PriestCard key={p.id} p={p} churches={churches} onChanged={onChanged} />)}</ul>}
    </>
  );
}

function PriestCard({ p, churches, onChanged }: { p: OwnerPriest; churches: Church[]; onChanged: () => void }) {
  const [supabase] = useState(() => createClient());
  const [edit, setEdit] = useState(false);
  const [church, setChurch] = useState(p.church_id);
  const [title, setTitle] = useState(p.title ?? '');
  const [days, setDays] = useState(String(p.reminder_days));
  const [notes, setNotes] = useState(p.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const statusTone: Record<string, string> = { approved: 'bg-emerald-100 text-emerald-700', suspended: 'bg-red-100 text-red-600', pending: 'bg-amber-100 text-amber-700', rejected: 'bg-slate-100 text-slate-500' };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); onChanged(); } catch (e) { setErr(priestErrorMessage(e)); } finally { setBusy(false); } };
  return (
    <li className="card !p-3">
      <div className="flex items-start gap-3">
        <PersonAvatar name={p.person.name} imageUrl={p.person.image_url} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold">{p.title ? `${p.title} ` : ''}{p.person.name}</p>
          <p className="truncate text-[11px] text-slate-400" dir="ltr">{p.person.national_id}{p.person.phone ? ` · ${p.person.phone}` : ''}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`badge ${statusTone[p.status]}`}>{PRIEST_STATUS_LABELS[p.status]}</span>
            <span className="badge bg-violet-100 text-violet-700">{p.church_name}</span>
            <span className="badge bg-slate-100 text-slate-500 tabular-nums">{p.confessors_count} معترف · {p.confessions_count} اعتراف</span>
            {p.pending_appointments > 0 && <span className="badge bg-amber-100 text-amber-700 tabular-nums">{p.pending_appointments} طلب موعد</span>}
            <span className="badge bg-slate-100 text-slate-500 tabular-nums">تذكير {p.reminder_days} يومًا</span>
          </div>
          {p.last_seen_at && <p className="mt-1 text-[10px] text-slate-400">آخر دخول: {fmtDateTime(p.last_seen_at)}</p>}
        </div>
        {p.person.phone && <a href={`tel:${p.person.phone}`} aria-label="اتصال" className="rounded-xl bg-teal-50 p-2 text-teal-700"><Phone className="h-4 w-4" /></a>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setEdit((v) => !v)} className="flex items-center gap-1 rounded-xl bg-violet-50 px-3 py-1.5 text-xs font-extrabold text-violet-700"><Pencil className="h-3.5 w-3.5" /> تعديل</button>
        {p.status === 'approved'
          ? <button type="button" disabled={busy} onClick={() => run(() => ownerUpdatePriest(supabase, p.id, { status: 'suspended' }))} className="flex items-center gap-1 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700"><Ban className="h-3.5 w-3.5" /> إيقاف</button>
          : <button type="button" disabled={busy} onClick={() => run(() => ownerUpdatePriest(supabase, p.id, { status: 'approved' }))} className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700"><Play className="h-3.5 w-3.5" /> تفعيل</button>}
        {!confirmDel ? <button type="button" onClick={() => setConfirmDel(true)} className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-extrabold text-red-600"><Trash2 className="h-3.5 w-3.5" /> حذف</button>
          : <span className="flex items-center gap-1 rounded-xl bg-red-50 px-2 py-1 text-xs font-bold text-red-700">حذف حساب الكاهن؟ (يبقى الشخص)
              <button type="button" disabled={busy} onClick={() => run(() => ownerDeletePriest(supabase, p.id))} className="rounded-lg bg-red-600 px-2 py-0.5 text-white">نعم</button>
              <button type="button" onClick={() => setConfirmDel(false)} className="rounded-lg bg-white px-2 py-0.5">لا</button></span>}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
      </div>
      {err && <p className="mt-1 text-xs font-bold text-red-600">{err}</p>}
      {edit && (
        <div className="mt-3 space-y-2 rounded-2xl border border-violet-100 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div><label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة</label>
              <select className="input-field" value={church} onChange={(e) => setChurch(e.target.value)}>{churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="mb-1 block text-xs font-bold text-slate-500">اللقب</label>
              <input className="input-field" list="priest-titles" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div><label className="mb-1 block text-xs font-bold text-slate-500">التذكير بعد (يوم)</label>
              <input type="number" min={1} max={365} className="input-field" value={days} onChange={(e) => setDays(e.target.value)} /></div>
            <div><label className="mb-1 block text-xs font-bold text-slate-500">ملاحظات المالك</label>
              <input className="input-field" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
          <datalist id="priest-titles">{TITLES.map((t) => <option key={t} value={t} />)}</datalist>
          <button type="button" disabled={busy} onClick={() => run(async () => { await ownerUpdatePriest(supabase, p.id, { church, title, notes, reminder_days: Number(days) || null }); setEdit(false); })} className="btn-primary flex w-full items-center justify-center gap-1 !bg-gradient-to-br !from-violet-600 !to-violet-800"><Check className="h-4 w-4" /> حفظ</button>
          <ResetPasswordSection idPrefix={`pw-${p.id}`} showDefault={false} hint="كلمة مرور جديدة لبوابة الكاهن — تُغلق جلساته الحالية"
            onReset={async (pw) => { try { await ownerSetPriestPassword(supabase, p.id, pw); return null; } catch (e) { return priestErrorMessage(e); } }} />
        </div>
      )}
    </li>
  );
}

// ---------- الطلبات ----------
function RequestsPanel({ requests, churches, onChanged }: { requests: PriestRequest[] | null; churches: Church[]; onChanged: () => void }) {
  const [view, setView] = useState<'pending' | 'history'>('pending');
  if (requests === null) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>;
  const list = requests.filter((r) => (view === 'pending' ? r.status === 'pending' : r.status !== 'pending'));
  return (
    <>
      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        <button role="tab" aria-selected={view === 'pending'} onClick={() => setView('pending')} className={`rounded-xl py-1.5 text-xs font-extrabold ${view === 'pending' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}>قيد المراجعة</button>
        <button role="tab" aria-selected={view === 'history'} onClick={() => setView('history')} className={`rounded-xl py-1.5 text-xs font-extrabold ${view === 'history' ? 'bg-white text-violet-700 shadow' : 'text-slate-500'}`}>السجل</button>
      </div>
      {list.length === 0 ? <div className="card py-10 text-center text-sm font-bold text-slate-400">{view === 'pending' ? 'لا طلبات جديدة' : 'لا سجل'}</div>
        : <ul className="space-y-2">{list.map((r) => <RequestCard key={r.id} r={r} churches={churches} onChanged={onChanged} />)}</ul>}
    </>
  );
}

function RequestCard({ r, churches, onChanged }: { r: PriestRequest; churches: Church[]; onChanged: () => void }) {
  const [supabase] = useState(() => createClient());
  const [church, setChurch] = useState(r.church_id ?? '');
  const [title, setTitle] = useState(r.title ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const churchName = churches.find((c) => c.id === r.church_id)?.name;
  const decide = async (approve: boolean) => {
    setBusy(true); setErr('');
    try { await reviewPriestRequest(supabase, r.id, approve, { note: note || null, church: approve ? church || null : null, title: approve ? title || null : null }); onChanged(); }
    catch (e) { setErr(priestErrorMessage(e)); } finally { setBusy(false); }
  };
  const tone: Record<string, string> = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-600' };
  return (
    <li className="card !p-3">
      <div className="flex items-start gap-3">
        <PersonAvatar name={r.name} imageUrl={r.image_url} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold">{r.title ? `${r.title} ` : ''}{r.name}</p>
          <p className="text-[11px] text-slate-400" dir="ltr">{r.code}{r.phone ? ` · ${r.phone}` : ''}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`badge ${tone[r.status]}`}>{r.status === 'pending' ? 'قيد المراجعة' : r.status === 'approved' ? 'مقبول' : 'مرفوض'}</span>
            {churchName && <span className="badge bg-violet-100 text-violet-700">{churchName}</span>}
            <span className="badge bg-slate-100 text-slate-500"><Clock className="ml-1 h-3 w-3" />{fmtDateTime(r.created_at)}</span>
          </div>
          {(r.address || r.birthdate || r.notes) && <p className="mt-1 text-[11px] text-slate-500">{[r.birthdate && `الميلاد ${fmtDay(r.birthdate)}`, r.address, r.notes].filter(Boolean).join(' · ')}</p>}
          {r.decision_note && <p className="mt-1 text-[11px] text-slate-400">↩ {r.decision_note}</p>}
        </div>
      </div>
      {r.status === 'pending' && (
        <div className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <select className="input-field" value={church} onChange={(e) => setChurch(e.target.value)} aria-label="الكنيسة"><option value="">اختر الكنيسة</option>{churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input className="input-field" list="priest-titles-req" placeholder="اللقب" value={title} onChange={(e) => setTitle(e.target.value)} />
            <datalist id="priest-titles-req">{TITLES.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <input className="input-field" placeholder="ملاحظة للكاهن (اختياري — تظهر عند الرفض)" value={note} onChange={(e) => setNote(e.target.value)} />
          {err && <p className="text-xs font-bold text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !church} onClick={() => decide(true)} className="btn-primary flex flex-1 items-center justify-center gap-1 !bg-gradient-to-br !from-emerald-500 !to-emerald-700">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} موافقة</button>
            <button type="button" disabled={busy} onClick={() => decide(false)} className="btn-secondary flex flex-1 items-center justify-center gap-1 !text-red-600"><X className="h-4 w-4" /> رفض</button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------- إضافة ----------
function AddPanel({ churches, onAdded }: { churches: Church[]; onAdded: () => void }) {
  const [supabase] = useState(() => createClient());
  const [church, setChurch] = useState(churches[0]?.id ?? '');
  useEffect(() => { if (!church && churches[0]) setChurch(churches[0].id); }, [churches, church]);
  const [title, setTitle] = useState('القس');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [gender] = useState<Gender>('male');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ code: string; password: string; name: string } | null>(null);
  const genCode = () => setCode(`PR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
  const genPw = () => { const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; let o = ''; const a = new Uint32Array(8); crypto.getRandomValues(a); a.forEach((n) => { o += chars[n % chars.length]; }); setPassword(o); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (!church) return setErr('اختر الكنيسة');
    if (!name.trim()) return setErr('اكتب الاسم');
    if (!code.trim()) return setErr('اكتب الكود أو ولّده');
    if (password.length < 6) return setErr('كلمة المرور 6 أحرف على الأقل');
    if (phoneLocal && phoneLocal.length !== PHONE_LOCAL_LENGTH) return setErr(`الهاتف ${PHONE_LOCAL_LENGTH} رقمًا`);
    setBusy(true);
    try {
      await ownerAddPriest(supabase, { code, name, password, church_id: church, title: title || null, gender, birthdate: null, phone: phoneLocal ? `${PHONE_PREFIX}${phoneLocal}` : null, address: null, notes: null, image_url: null });
      setDone({ code: code.trim(), password, name: `${title ? `${title} ` : ''}${name.trim()}` });
      setName(''); setCode(''); setPassword(''); setPhoneLocal('');
    } catch (er) { setErr(priestErrorMessage(er)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="card space-y-3">
      {done && (
        <div className="rounded-2xl bg-emerald-50 p-3 text-sm">
          <p className="font-extrabold text-emerald-800">تمت إضافة {done.name} ✔ — بيانات الدخول (تظهر مرة واحدة):</p>
          <p className="mt-1 font-bold text-slate-700" dir="ltr">code: {done.code} · password: {done.password}</p>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(`${done.name}\nالكود: ${done.code}\nكلمة المرور: ${done.password}`); }} className="mt-2 rounded-xl bg-white px-3 py-1 text-xs font-bold text-emerald-700">نسخ</button>
          <button type="button" onClick={() => { setDone(null); onAdded(); }} className="mt-2 mr-2 rounded-xl bg-emerald-600 px-3 py-1 text-xs font-bold text-white">تم</button>
        </div>
      )}
      <div><label className="mb-1 block text-xs font-bold text-slate-500">الكنيسة *</label>
        <select className="input-field" value={church} onChange={(e) => setChurch(e.target.value)}>{churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="mb-1 block text-xs font-bold text-slate-500">اللقب</label><select className="input-field !px-2" value={title} onChange={(e) => setTitle(e.target.value)}>{TITLES.map((t) => <option key={t} value={t}>{t}</option>)}<option value="">بدون</option></select></div>
        <div className="col-span-2"><label className="mb-1 block text-xs font-bold text-slate-500">الاسم *</label><input className="input-field" value={name} onChange={(e) => setName(e.target.value)} /></div>
      </div>
      <div><label className="mb-1 block text-xs font-bold text-slate-500">الكود (اسم الدخول) *</label>
        <div className="flex gap-2"><input className="input-field flex-1" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} /><button type="button" onClick={genCode} className="rounded-xl bg-violet-600 px-3 text-xs font-extrabold text-white">توليد</button></div>
        <p className="mt-1 text-[11px] text-slate-400">كود موجود لشخص مسجّل يربط حساب الكاهن به.</p></div>
      <div><label className="mb-1 block text-xs font-bold text-slate-500">كلمة المرور *</label>
        <div className="flex gap-2"><input className="input-field flex-1" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" onClick={genPw} className="rounded-xl bg-violet-600 px-3 text-xs font-extrabold text-white"><KeyRound className="h-4 w-4" /></button></div></div>
      <div><label className="mb-1 block text-xs font-bold text-slate-500">الهاتف</label>
        <div className="flex items-stretch overflow-hidden rounded-xl border border-indigo-100 bg-white" dir="ltr"><span className="flex items-center bg-violet-50 px-3 text-sm font-extrabold text-violet-700">{PHONE_PREFIX}</span>
          <input type="tel" inputMode="numeric" className="w-full px-3 py-2.5 text-sm font-bold outline-none" placeholder="01xxxxxxxxx" value={phoneLocal} maxLength={PHONE_LOCAL_LENGTH} onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, PHONE_LOCAL_LENGTH))} /></div></div>
      {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{err}</p>}
      <button type="submit" disabled={busy} className="btn-primary flex w-full items-center justify-center gap-2 !bg-gradient-to-br !from-violet-600 !to-violet-800">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />} إضافة الكاهن (مفعّل فورًا)</button>
    </form>
  );
}
