'use client';

// ---------- FAMILY MODULE (العائلات) — servants' app ----------
// Since migration 20260928120000 the PRIEST creates and manages families from
// his portal (/priest/families — area · street · building · visits).
// 20260930130000: when the owner has opened the module, مالك التطبيق and
// مدير الكنيسة manage families here too (create · members · edit · delete —
// the church manager inside his church). Everybody else sees the families of
// his scope read-only — the scanner (/scanner) still resolves ANY member's
// code to the whole family. `family_permissions()` (DB) decides `manage`.
// URL: /family · /family?tab=qr&family=<id> (إضافة أفراد)

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  UsersRound, Plus, Search, Loader2, ArrowRight, ScanLine, ChevronDown, Info, Trash2, Lock, UserPlus,
} from 'lucide-react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';
import { useDebouncedRealtime } from '@/lib/realtime';
import { useNavLabel } from '@/lib/customization-context';
import {
  fetchFamilies, fetchFamilyPermissions, memberCount,
  type Family, type FamilyMemberWithPerson, type FamilyPermissions,
} from '@/lib/families';
import { FamilyCard, FamilyMemberRow, FamilyFormModal, FamilyCodeModal } from '@/components/family/FamilyBits';
import AddMembersPanel from '@/components/family/AddMembersPanel';

type Tab = 'list' | 'qr';

export default function FamilyPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>}>
        <FamilyModule />
      </Suspense>
    </AppShell>
  );
}

function FamilyModule() {
  const pageName = useNavLabel('family');
  const { profile } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [supabase] = useState(() => createClient());

  const tab: Tab = params.get('tab') === 'qr' ? 'qr' : 'list';
  const qrFamilyId = params.get('family') ?? '';
  const go = (t: Tab, familyId?: string) => {
    const q = new URLSearchParams();
    if (t === 'qr') q.set('tab', 'qr');
    if (familyId) q.set('family', familyId);
    const s = q.toString();
    router.replace(s ? `/family?${s}` : '/family');
  };

  // ---------- data ----------
  // `manage` = owner / church manager with the module open (DB: family_can)
  const [perms, setPerms] = useState<FamilyPermissions>({ view: false, manage: false });
  const [families, setFamilies] = useState<Family[]>([]);
  const [members, setMembers] = useState<FamilyMemberWithPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbMissing, setDbMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, data] = await Promise.all([fetchFamilyPermissions(supabase), fetchFamilies(supabase)]);
      setPerms(p);
      setFamilies(data.families);
      setMembers(data.members);
      setDbMissing(false);
    } catch {
      setDbMissing(true);
    } finally {
      setLoading(false);
    }
  }, [supabase]);
  useEffect(() => { if (profile?.status === 'approved') load(); }, [profile?.status, load]);
  useDebouncedRealtime(supabase, 'family-module', [{ table: 'families' }, { table: 'family_members' }], load, {
    enabled: profile?.status === 'approved', delayMs: 600,
  });

  const membersOf = useMemo(() => {
    const m = new Map<string, FamilyMemberWithPerson[]>();
    members.forEach((x) => { (m.get(x.family_id) ?? m.set(x.family_id, []).get(x.family_id)!).push(x); });
    return m;
  }, [members]);

  // ---------- list tab state ----------
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; family: Family | null; thenQr?: boolean }>({ open: false, family: null });
  const [codeFor, setCodeFor] = useState<Family | null>(null);
  const [deleteFor, setDeleteFor] = useState<Family | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return families;
    return families.filter((f) =>
      f.name.toLowerCase().includes(q) ||
      f.code.toLowerCase().includes(q) ||
      (f.phone ?? '').includes(q) ||
      (membersOf.get(f.id) ?? []).some((m) => m.person.name.toLowerCase().includes(q) || m.person.national_id.toLowerCase().includes(q)));
  }, [families, membersOf, search]);

  const onSaved = (f: Family, thenQr?: boolean) => {
    setFamilies((prev) => {
      const i = prev.findIndex((x) => x.id === f.id);
      const next = i >= 0 ? prev.map((x) => (x.id === f.id ? f : x)) : [...prev, f];
      return next.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    });
    setForm({ open: false, family: null });
    if (thenQr) go('qr', f.id);
  };

  const doDelete = async () => {
    if (!deleteFor) return;
    setDeleting(true);
    const { error } = await supabase.from('families').delete().eq('id', deleteFor.id);
    setDeleting(false);
    if (!error) {
      setFamilies((prev) => prev.filter((x) => x.id !== deleteFor.id));
      setMembers((prev) => prev.filter((x) => x.family_id !== deleteFor.id));
    }
    setDeleteFor(null);
  };

  // ---------- QR tab ----------
  const qrFamily = families.find((f) => f.id === qrFamilyId) ?? null;

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>;
  }

  return (
    <>
      <section className="mb-4 flex items-center gap-2">
        <Link href="/settings" aria-label="رجوع" className="rounded-full p-1.5 hover:bg-slate-100">
          <ArrowRight className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-extrabold">
            <UsersRound className="h-5 w-5 text-teal-700" /> {pageName}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {perms.manage
              ? 'أنشئ العائلة بكودها وأضف أفرادها — وعند مسح كود أي فرد في الماسح تظهر العائلة كلها لاختيار الشخص والخدمة'
              : 'عائلات نطاقك وأفرادها — وعند مسح كود أي فرد في الماسح تظهر العائلة كلها لاختيار الشخص والخدمة'}
          </p>
        </div>
        <Link href="/scanner" className="btn-secondary flex items-center gap-1.5 !py-2 !px-3 text-xs" title="الماسح">
          <ScanLine className="h-4 w-4" /> الماسح
        </Link>
      </section>

      {dbMissing && (
        <p className="mb-4 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
          تعذر تحميل العائلات — تأكد من تطبيق تحديث قاعدة البيانات (20260924120000_families)
        </p>
      )}

      <p id="family-moved" className="mb-4 flex items-start gap-2 rounded-2xl bg-violet-50 px-3 py-2.5 text-xs font-bold text-violet-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        {perms.manage ? (
          <span>الكاهن يربط العائلة بالمنطقة والشارع والعمارة ويسجّل الزيارات من <b>بوابته</b> (الافتقاد الأسري) — ومن هنا تنشئ العائلات وتضيف أفرادها وتعدّلها كمالك للتطبيق أو مدير للكنيسة.</span>
        ) : (
          <span>إنشاء العائلات وإضافة أفرادها يقوم به <b>الكاهن</b> من بوابته (الافتقاد الأسري) أو <b>مالك التطبيق / مدير الكنيسة</b>. هنا ترى عائلات نطاقك فقط.</span>
        )}
      </p>

      {/* ================= tabs (managers only) ================= */}
      {perms.manage && (
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
          <button id="family-tab-list" type="button" onClick={() => go('list')}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-extrabold transition ${tab === 'list' ? 'bg-white text-teal-700 shadow' : 'text-slate-500'}`}>
            <UsersRound className="h-4 w-4" /> العائلات
          </button>
          <button id="family-tab-qr" type="button" onClick={() => go('qr', qrFamilyId || undefined)}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-extrabold transition ${tab === 'qr' ? 'bg-white text-teal-700 shadow' : 'text-slate-500'}`}>
            <UserPlus className="h-4 w-4" /> إضافة أفراد
          </button>
        </div>
      )}

      {/* ================= LIST ================= */}
      {tab === 'list' && (
        <>
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input id="family-search" className="input-field pr-9" placeholder="ابحث باسم العائلة أو الكود أو اسم فرد…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {perms.manage && (
              <button id="family-new" type="button" onClick={() => setForm({ open: true, family: null })} className="btn-primary flex items-center gap-1.5 !px-4">
                <Plus className="h-4 w-4" /> عائلة
              </button>
            )}
          </div>



          {filtered.length === 0 ? (
            <div className="card py-10 text-center">
              <UsersRound className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              <p className="font-bold text-slate-500">
                {families.length === 0
                  ? (perms.manage ? 'لا توجد عائلات بعد' : 'لا توجد عائلات في نطاقك بعد — ينشئها الكاهن أو مدير الكنيسة')
                  : 'لا نتائج للبحث'}
              </p>
              {perms.manage && families.length === 0 && (
                <button type="button" onClick={() => setForm({ open: true, family: null, thenQr: true })} className="btn-primary mt-4 inline-flex items-center gap-1.5 !py-2 !px-4 text-sm">
                  <Plus className="h-4 w-4" /> أنشئ أول عائلة ثم أضف أفرادها
                </button>
              )}
            </div>
          ) : (
            <ul id="family-list" className="space-y-2.5">
              {filtered.map((f) => {
                const ms = membersOf.get(f.id) ?? [];
                const open = openId === f.id;
                return (
                  <div key={f.id}>
                    <FamilyCard
                      family={f}
                      members={ms}
                      canManage={perms.manage}
                      onOpen={() => setOpenId(open ? null : f.id)}
                      onAddMembers={() => go('qr', f.id)}
                      onEdit={() => setForm({ open: true, family: f })}
                      onDelete={() => setDeleteFor(f)}
                      onShowCode={() => setCodeFor(f)}
                    />
                    {open && (
                      <div id={`family-members-${f.id}`} className="mx-2 -mt-1 rounded-b-2xl border-2 border-t-0 border-teal-100 bg-white p-3">
                        {(f.address || f.notes) && (
                          <p className="mb-2 text-[11px] font-bold text-slate-500">{[f.address, f.notes].filter(Boolean).join(' · ')}</p>
                        )}
                        {ms.length === 0 ? (
                          <p className="py-3 text-center text-xs font-bold text-slate-400">لا يوجد أفراد — لم يُضَف أحد بعد</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {ms.map((m) => (
                              <FamilyMemberRow
                                key={m.id}
                                member={m}
                                canManage={perms.manage}
                                onChanged={(rel) => setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, relation: rel } : x)))}
                                onRemoved={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
                              />
                            ))}
                          </ul>
                        )}
                        {perms.manage && (
                          <button type="button" onClick={() => go('qr', f.id)} className="btn-secondary mt-3 flex w-full items-center justify-center gap-1.5 !py-2 text-sm">
                            <UserPlus className="h-4 w-4" /> إضافة أفراد
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* ================= QR ================= */}
      {tab === 'qr' && (
        !perms.manage ? (
          <div className="card py-10 text-center">
            <Lock className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            <p className="font-bold text-slate-500">إضافة الأفراد لمالك التطبيق ومدير الكنيسة فقط — أو الكاهن من بوابته</p>
          </div>
        ) : (
          <>
            <label className="mb-1 block text-xs font-bold text-slate-500">العائلة التي ستُضاف إليها الأفراد</label>
            <div className="mb-4 flex gap-2">
              <div className="relative flex-1">
                <select
                  id="family-qr-select"
                  aria-label="اختيار العائلة"
                  className="input-field appearance-none pl-9 text-sm font-bold"
                  value={qrFamilyId}
                  onChange={(e) => go('qr', e.target.value || undefined)}
                >
                  <option value="">اختر العائلة *</option>
                  {families.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} — {memberCount((membersOf.get(f.id) ?? []).length)}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
              <button id="family-qr-new" type="button" onClick={() => setForm({ open: true, family: null, thenQr: true })} className="btn-secondary flex items-center gap-1.5 !px-3 text-sm" title="عائلة جديدة">
                <Plus className="h-4 w-4" /> جديدة
              </button>
            </div>

            {qrFamily ? (
              <AddMembersPanel
                key={qrFamily.id}
                family={qrFamily}
                members={membersOf.get(qrFamily.id) ?? []}
                onAdded={() => load()}
              />
            ) : (
              <div className="card py-10 text-center">
                <Info className="mx-auto mb-2 h-8 w-8 text-teal-300" />
                <p className="text-sm font-bold text-slate-500">اختر عائلة من القائمة أو أنشئ عائلة جديدة — ثم أضف أفرادها بمسح الكود أو البحث أو إنشاء فرد جديد</p>
              </div>
            )}
          </>
        )
      )}

      {/* ---------- modals ---------- */}
      {form.open && (
        <FamilyFormModal family={form.family} onSaved={(f) => onSaved(f, form.thenQr)} onClose={() => setForm({ open: false, family: null })} />
      )}
      {codeFor && <FamilyCodeModal family={codeFor} onClose={() => setCodeFor(null)} />}
      {deleteFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setDeleteFor(null)}>
          <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-sm sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 flex items-center gap-2 text-lg font-extrabold text-red-600"><Trash2 className="h-5 w-5" /> حذف العائلة</h3>
            <p className="mb-4 text-sm font-bold text-slate-600">
              حذف «{deleteFor.name}» يفكّ ارتباط أفرادها ({(membersOf.get(deleteFor.id) ?? []).length}) — بيانات الأشخاص وتسجيلاتهم تبقى كما هي.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button id="family-delete-confirm" type="button" onClick={doDelete} disabled={deleting} className="flex items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 font-extrabold text-white shadow active:scale-95 disabled:opacity-50">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} حذف
              </button>
              <button type="button" onClick={() => setDeleteFor(null)} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
