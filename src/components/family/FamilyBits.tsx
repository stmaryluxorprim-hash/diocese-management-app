'use client';

// ---------- Family module shared pieces (العائلات) ----------
//   FamilyCard       — one family: name · code · members count · actions
//   FamilyMemberRow  — one member: avatar · name · code · relation · remove
//   FamilyFormModal  — create / edit a family (name · phone · address · notes)
//   FamilyCodeModal  — the family's own QR (F-XXXXXX) to print / share
// The «إضافة أفراد» panel lives in AddMembersPanel.tsx.

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  UsersRound, QrCode, Pencil, Trash2, Loader2, Check, X, Phone, MapPin, StickyNote,
  UserPlus, Hash, Copy, Share2, Wand2, ScanLine, Church as ChurchIcon, ChevronDown,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PersonAvatar } from '@/components/CallFeedback';
import { ModalFrame } from '@/components/PersonDataModals';
import QrScanner from '@/components/store/QrScanner';
import { useCodeGenerator } from '@/lib/customization-context';
import {
  RELATIONS, RELATION_LABELS, relationLabel, memberCount,
  removeFamilyMember, setFamilyMemberRelation, lookupFamilyCode, fetchFamilyManageChurches,
  type Family, type FamilyMemberWithPerson, type FamilyRelation, type FamilyCodeLookup,
} from '@/lib/families';
import { cachedLookup } from '@/lib/queries';
import type { Church } from '@/lib/types';

// =====================================================================
// FamilyCard
// =====================================================================
export function FamilyCard({
  family, members, canManage, onOpen, onAddMembers, onEdit, onDelete, onShowCode,
}: {
  family: Family;
  members: FamilyMemberWithPerson[];
  canManage: boolean;
  onOpen: () => void;
  onAddMembers: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowCode: () => void;
}) {
  return (
    <li id={`family-${family.id}`} className="card !py-3 !border-2 !border-teal-100">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-right">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-emerald-500 text-white shadow-sm">
            <UsersRound className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-extrabold">{family.name}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-bold text-slate-400">
              <span className="inline-flex items-center gap-0.5 font-mono" dir="ltr"><Hash className="h-3 w-3" />{family.code}</span>
              <span>· {memberCount(members.length)}</span>
              {family.phone && <span className="inline-flex items-center gap-0.5"><Phone className="h-3 w-3" />{family.phone}</span>}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onShowCode} aria-label="كود العائلة" title="كود العائلة (QR)"
            className="rounded-xl bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200 active:scale-95">
            <QrCode className="h-4 w-4" />
          </button>
          {canManage && (
            <>
              <button type="button" onClick={onAddMembers} aria-label="إضافة أفراد" title="إضافة أفراد"
                className="rounded-xl bg-teal-500 p-2 text-white shadow transition hover:bg-teal-600 active:scale-95">
                <UserPlus className="h-4 w-4" />
              </button>
              <button type="button" onClick={onEdit} aria-label="تعديل العائلة"
                className="rounded-xl bg-amber-50 p-2 text-amber-600 transition hover:bg-amber-100 active:scale-95">
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" onClick={onDelete} aria-label="حذف العائلة"
                className="rounded-xl bg-red-50 p-2 text-red-500 transition hover:bg-red-100 active:scale-95">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
      {members.length > 0 && (
        <div className="mt-2.5 flex -space-x-2 space-x-reverse overflow-hidden">
          {members.slice(0, 8).map((m) => (
            <span key={m.id} title={m.person.name}><PersonAvatar name={m.person.name} imageUrl={m.person.image_url} size={30} /></span>
          ))}
          {members.length > 8 && (
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-xl bg-slate-100 text-[10px] font-extrabold text-slate-500 ring-2 ring-white">
              +{members.length - 8}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

// =====================================================================
// FamilyMemberRow
// =====================================================================
export function FamilyMemberRow({
  member, canManage, onChanged, onRemoved,
}: {
  member: FamilyMemberWithPerson;
  canManage: boolean;
  onChanged: (relation: FamilyRelation | null) => void;
  onRemoved: () => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const changeRelation = async (v: string) => {
    const rel = (v || null) as FamilyRelation | null;
    setBusy(true);
    try { await setFamilyMemberRelation(supabase, member.id, rel); onChanged(rel); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await removeFamilyMember(supabase, member.id); onRemoved(); } finally { setBusy(false); setConfirm(false); }
  };

  return (
    <li id={`family-member-${member.id}`} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
      <PersonAvatar name={member.person.name} imageUrl={member.person.image_url} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold">{member.person.name}</p>
        <p className="truncate font-mono text-[11px] font-bold text-slate-400" dir="ltr">{member.person.national_id}</p>
      </div>
      {canManage ? (
        <select
          aria-label="صلة القرابة"
          className="input-field !w-auto !py-1.5 !px-2 appearance-none text-xs font-bold"
          value={member.relation ?? ''}
          disabled={busy}
          onChange={(e) => changeRelation(e.target.value)}
        >
          <option value="">الصلة…</option>
          {RELATIONS.map((r) => <option key={r} value={r}>{RELATION_LABELS[r]}</option>)}
        </select>
      ) : (
        member.relation && <span className="badge bg-teal-100 text-teal-700">{relationLabel(member.relation)}</span>
      )}
      {canManage && (
        confirm ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={remove} disabled={busy} aria-label="تأكيد الإزالة"
              className="rounded-lg bg-red-500 p-1.5 text-white">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => setConfirm(false)} aria-label="إلغاء" className="rounded-lg bg-slate-200 p-1.5 text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} aria-label="إزالة من العائلة"
            className="rounded-lg bg-red-50 p-1.5 text-red-500 transition hover:bg-red-100">
            <Trash2 className="h-4 w-4" />
          </button>
        )
      )}
    </li>
  );
}

// =====================================================================
// FamilyFormModal — create / edit
// The CODE is set by the servant: typed · scanned (camera / gallery) ·
// generated by نظام الأكواد (generator `family`). Live check through
// `family_code_lookup`: a code that belongs to another family or to a
// PERSON is refused (the scanner must tell the two apart).
// =====================================================================
export function FamilyFormModal({
  family, onSaved, onClose,
}: {
  family: Family | null;
  onSaved: (f: Family) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const genCode = useCodeGenerator('family');
  const [code, setCode] = useState(family?.code ?? '');
  const [name, setName] = useState(family?.name ?? '');
  const [phone, setPhone] = useState(family?.phone ?? '');
  const [address, setAddress] = useState(family?.address ?? '');
  const [notes, setNotes] = useState(family?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qr, setQr] = useState('');
  const [check, setCheck] = useState<FamilyCodeLookup | null>(null);
  const [checking, setChecking] = useState(false);

  // 20260930130000: the church of the family — owner picks one; a church
  // manager of ONE church gets it automatically (the DB fills it anyway)
  const [churchId, setChurchId] = useState<string>(family?.church_id ?? '');
  const [churches, setChurches] = useState<Church[]>([]);
  const [churchesLoaded, setChurchesLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [allowed, all] = await Promise.all([fetchFamilyManageChurches(supabase), cachedLookup<Church>(supabase, 'churches')]);
      if (!alive) return;
      const list = all.filter((c) => allowed.includes(c.id));
      setChurches(list);
      setChurchesLoaded(true);
      if (!family && list.length === 1) setChurchId(list[0].id);
    })();
    return () => { alive = false; };
  }, [supabase, family]);
  const needsChurchPick = churches.length > 1;

  // QR preview of the code
  useEffect(() => {
    const c = code.trim();
    if (!c) { setQr(''); return; }
    QRCode.toDataURL(c, { width: 320, margin: 1, color: { dark: '#0f766e', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
  }, [code]);

  // live check (debounced) — unchanged code of the edited family is fine
  useEffect(() => {
    const c = code.trim();
    setCheck(null);
    if (!c || (family && c === family.code)) { setChecking(false); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      try { setCheck(await lookupFamilyCode(supabase, c)); } catch { setCheck(null); } finally { setChecking(false); }
    }, 400);
    return () => { clearTimeout(t); setChecking(false); };
  }, [code, family, supabase]);

  const codeTaken = !!check && !check.free;
  const codeHint = check
    ? check.family ? `هذا الكود لعائلة «${check.family.name}»` : check.person ? `هذا الكود لشخص (${check.person.name}) — كود العائلة يجب أن يختلف عن أكواد الأفراد` : 'الكود متاح ✔'
    : '';

  const submit = async () => {
    const n = name.trim();
    if (!n) { setError('اكتب اسم العائلة'); return; }
    if (codeTaken) { setError(codeHint); return; }
    if (!family && needsChurchPick && !churchId) { setError('اختر كنيسة العائلة'); return; }
    setBusy(true); setError('');
    const payload = {
      name: n,
      code: code.trim() || (family ? family.code : genCode()),
      phone: phone.trim() || null, address: address.trim() || null, notes: notes.trim() || null,
      // only sent when chosen — the DB trigger fills a church manager's church itself
      ...(churchId && (!family || family.church_id !== churchId) ? { church_id: churchId } : {}),
    };
    const q = family
      ? supabase.from('families').update(payload).eq('id', family.id).select('*').single()
      : supabase.from('families').insert(payload).select('*').single();
    const { data, error: err } = await q;
    setBusy(false);
    if (err || !data) {
      const m = err?.message ?? '';
      setError(
        m.includes('row-level security') ? 'ليس لديك صلاحية إدارة العائلات — مالك التطبيق ومدير الكنيسة فقط'
        : m.includes('church_required') ? 'اختر كنيسة العائلة'
        : m.includes('church_forbidden') ? 'لا يمكن إنشاء عائلة في كنيسة أخرى'
        : m.includes('area_church_mismatch') ? 'منطقة العائلة من كنيسة أخرى — لا يمكن تغيير الكنيسة'
        : m.includes('code_is_person') ? 'هذا الكود لشخص — اختر كوداً آخر للعائلة'
        : m.includes('duplicate') || m.includes('unique') ? 'هذا الكود مستخدم لعائلة أخرى'
        // unknown DB error → show its text so the cause is visible (not just «check the database»)
        : `تعذر الحفظ — ${m || 'خطأ غير معروف'} (تأكد من تطبيق آخر تحديث لقاعدة البيانات)`);
      return;
    }
    onSaved(data as Family);
  };

  return (
    <>
      <ModalFrame title={family ? 'تعديل العائلة' : 'عائلة جديدة'} icon={<UsersRound className="h-5 w-5 text-teal-600" />} onClose={onClose}>
        {/* ---- code: type · scan · generate ---- */}
        <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500">
          <QrCode className="h-3.5 w-3.5 text-teal-600" /> كود العائلة (QR) *
        </label>
        <div className="mb-1 flex gap-2">
          <input
            id="family-code"
            className={`input-field flex-1 font-mono ${codeTaken ? '!border-red-300 !bg-red-50' : check?.free ? '!border-emerald-300' : ''}`}
            dir="ltr"
            placeholder="اكتب الكود أو امسحه أو ولّده"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button id="family-code-generate" type="button" onClick={() => setCode(genCode())} aria-label="توليد كود" title="توليد كود (نظام الأكواد)"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow transition hover:bg-primary-700 active:scale-95">
            <Wand2 className="h-5 w-5" />
          </button>
          <button id="family-code-scan" type="button" onClick={() => setScanOpen(true)} aria-label="مسح الكود بالكاميرا" title="مسح الكود بالكاميرا"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow transition hover:bg-orange-600 active:scale-95">
            <ScanLine className="h-5 w-5" />
          </button>
          <button id="family-code-qr" type="button" disabled={!qr} onClick={() => setShowQr((v) => !v)} aria-label="عرض QR" title="عرض / إخفاء الـ QR"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow transition hover:bg-teal-700 active:scale-95 disabled:opacity-40">
            <QrCode className="h-5 w-5" />
          </button>
        </div>
        <p className={`mb-3 flex items-center gap-1 text-[11px] font-bold ${codeTaken ? 'text-red-600' : check?.free ? 'text-emerald-600' : 'text-slate-400'}`}>
          {checking ? <><Loader2 className="h-3 w-3 animate-spin" /> جارٍ التحقق من الكود…</>
            : codeHint || (code.trim() ? '' : 'اتركه فارغاً ليُولَّد تلقائياً عند الحفظ')}
        </p>
        {showQr && qr && (
          <div className="mb-3 rounded-2xl border-2 border-teal-100 bg-white p-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR" className="mx-auto w-40" />
            <p className="mt-1 font-mono text-sm font-extrabold tracking-widest text-teal-700" dir="ltr">{code.trim()}</p>
          </div>
        )}

        <label className="mb-1 block text-xs font-bold text-slate-500">اسم العائلة *</label>
        <input id="family-name" className="input-field mb-3" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: عائلة جرجس" />

        {/* church — the owner (or a manager of several churches) chooses; one church = shown read-only */}
        {churchesLoaded && churches.length > 0 && (
          <>
            <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><ChurchIcon className="h-3.5 w-3.5" /> الكنيسة {needsChurchPick && !family ? '*' : ''}</label>
            {needsChurchPick ? (
              <div className="relative mb-3">
                <select
                  id="family-church"
                  aria-label="كنيسة العائلة"
                  className="input-field appearance-none pl-9 text-sm font-bold"
                  value={churchId}
                  onChange={(e) => setChurchId(e.target.value)}
                >
                  <option value="">اختر الكنيسة</option>
                  {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            ) : (
              <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{churches[0].name}</p>
            )}
          </>
        )}
        <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><Phone className="h-3.5 w-3.5" /> هاتف (اختياري)</label>
        <input id="family-phone" className="input-field mb-3" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" />
        <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><MapPin className="h-3.5 w-3.5" /> العنوان (اختياري)</label>
        <input id="family-address" className="input-field mb-3" value={address} onChange={(e) => setAddress(e.target.value)} />
        <label className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-500"><StickyNote className="h-3.5 w-3.5" /> ملاحظات</label>
        <textarea id="family-notes" className="input-field mb-3 min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
        <button id="family-save" type="button" onClick={submit} disabled={busy || checking || codeTaken} className="btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          {family ? 'حفظ التعديلات' : 'إنشاء العائلة'}
        </button>
      </ModalFrame>

      {scanOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setScanOpen(false)}>
          <div className="w-full max-w-xs rounded-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-base font-extrabold"><ScanLine className="h-5 w-5 text-orange-500" /> مسح كود العائلة</h3>
              <button type="button" onClick={() => setScanOpen(false)} aria-label="إغلاق" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <QrScanner idPrefix="family-code-scan" autoStart hint="وجّه الكاميرا إلى كود العائلة المطبوع" onCode={(v) => { setCode(v.trim()); setScanOpen(false); }} />
            <p className="mt-3 text-center text-[11px] font-bold text-slate-400">سيُوضع الكود الممسوح في خانة كود العائلة</p>
          </div>
        </div>
      )}
    </>
  );
}

// =====================================================================
// FamilyCodeModal — the family's QR
// =====================================================================
export function FamilyCodeModal({ family, onClose }: { family: Family; onClose: () => void }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(family.code, { width: 480, margin: 2, color: { dark: '#0f766e', light: '#ffffff' } })
      .then(setQr).catch(() => setQr(''));
  }, [family.code]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(family.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };
  const share = async () => {
    try { await navigator.share({ title: family.name, text: `كود عائلة ${family.name}: ${family.code}` }); } catch { /* noop */ }
  };
  return (
    <ModalFrame title="كود العائلة" icon={<QrCode className="h-5 w-5 text-teal-600" />} onClose={onClose}>
      <p className="mb-3 text-center text-sm font-extrabold">{family.name}</p>
      <div className="mx-auto mb-3 w-56 overflow-hidden rounded-2xl border-2 border-teal-100 bg-white p-2">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`QR ${family.code}`} className="h-full w-full" />
        ) : (
          <div className="flex aspect-square items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
        )}
      </div>
      <p className="mb-4 text-center font-mono text-xl font-extrabold tracking-widest text-teal-700" dir="ltr">{family.code}</p>
      <p className="mb-4 rounded-xl bg-teal-50 px-3 py-2 text-center text-[11px] font-bold text-teal-700">
        مسح هذا الكود في الماسح يعرض كل أفراد العائلة — مثل مسح كود أي فرد منها
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={copy} className="btn-secondary flex items-center justify-center gap-1.5">
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />} {copied ? 'تم النسخ' : 'نسخ الكود'}
        </button>
        <button type="button" onClick={share} className="btn-secondary flex items-center justify-center gap-1.5">
          <Share2 className="h-4 w-4" /> مشاركة
        </button>
      </div>
    </ModalFrame>
  );
}
