'use client';

// ---------- المسموح لهم — who may enter this access event ----------
// Two ways to add: a GROUP (church → service → class; leave service / class
// on «الكل» for the whole level) or PERSONS (search by name / phone / code,
// or scan a code — multi-select then «إضافة»). Existing entries are listed
// by kind with a remove button. A person NOT covered by any entry is denied
// even when every rule passes (unless the event is «مفتوحة للجميع»).

import { useEffect, useMemo, useState } from 'react';
import { Users, UserPlus, Church as ChurchIcon, Layers, School, Trash2, Loader2, Search, Hash, Plus, Check, ScanLine, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { PersonAvatar } from '@/components/CallFeedback';
import QrScanner from '@/components/store/QrScanner';
import {
  addAllowed, removeAllowed, searchPersonsForAccess, allowedKind, allowedLabel, ALLOWED_KIND_LABELS,
  type AccessAllowedWithPerson, type AccessEvent, type AccessSearchHit, type AllowedKind, type RuleLookups,
} from '@/lib/access';
import type { ScopeLookups } from '@/components/access/AccessForms';
import { HintBox } from '@/components/access/AccessBits';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { classSel, classTargets } from '@/lib/class-multi';

const ALL = 'all';
const KIND_ICON: Record<AllowedKind, typeof Users> = { person: Users, church: ChurchIcon, service: Layers, class: School };

export default function AllowedPanel({
  event, allowed, scope, lookups, canManage, onChanged,
}: {
  event: AccessEvent;
  allowed: AccessAllowedWithPerson[];
  scope: ScopeLookups;
  lookups: RuleLookups;
  canManage: boolean;
  onChanged: (next: AccessAllowedWithPerson[]) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<'group' | 'persons'>('group');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- group form ----
  const [churchId, setChurchId] = useState(event.church_id);
  const [serviceId, setServiceId] = useState(event.service_id ?? ALL);
  const [classIds, setClassIds] = useState<string[]>(classSel(event.class_id)); // [] = كل الفصول
  const visibleServices = useMemo(() => scope.services.filter((s) => s.church_id === churchId), [scope.services, churchId]);
  const visibleClasses = useMemo(() => scope.classes.filter((c) => c.church_id === churchId && (serviceId === ALL || c.service_id === serviceId)), [scope.classes, churchId, serviceId]);

  const addGroup = async () => {
    if (!churchId) return;
    setBusy(true); setMsg(null);
    try {
      const targets = serviceId === ALL ? [null] : classTargets(classIds);
      const { added, skipped } = await addAllowed(supabase, targets.map((cid) => ({
        event_id: event.id, person_id: null, church_id: churchId,
        service_id: serviceId === ALL ? null : serviceId,
        class_id: cid,
        note: null,
      })));
      if (added.length) onChanged([...allowed, ...added]);
      setMsg(skipped && !added.length ? { ok: false, text: 'هذه المجموعة مضافة بالفعل' } : { ok: true, text: skipped ? `أُضيف ${added.length} · ${skipped} كان مضافاً` : 'أُضيفت المجموعة' });
    } catch (e) {
      setMsg({ ok: false, text: 'تعذر الإضافة — ' + ((e as { message?: string }).message ?? '') });
    } finally { setBusy(false); }
  };

  // ---- persons ----
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AccessSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Map<string, AccessSearchHit['person']>>(new Map());
  const [scanOpen, setScanOpen] = useState(false);
  const listedPersonIds = useMemo(() => new Set(allowed.filter((a) => a.person_id).map((a) => a.person_id!)), [allowed]);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try { const res = await searchPersonsForAccess(supabase, s, 30); if (!cancelled) setHits(res); }
      catch { if (!cancelled) setHits([]); }
      finally { if (!cancelled) setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, supabase]);

  const togglePick = (p: AccessSearchHit['person']) => setPicked((m) => {
    const n = new Map(m);
    if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p);
    return n;
  });

  const onScan = async (code: string) => {
    const res = await searchPersonsForAccess(supabase, code, 5);
    const exact = res.find((h) => h.person.national_id === code.trim()) ?? res[0];
    if (!exact) { setMsg({ ok: false, text: `كود غير معروف: ${code}` }); return; }
    if (listedPersonIds.has(exact.person.id)) { setMsg({ ok: false, text: `${exact.person.name} مضاف بالفعل` }); return; }
    setPicked((m) => new Map(m).set(exact.person.id, exact.person));
    setMsg({ ok: true, text: `تم اختيار ${exact.person.name}` });
  };

  const addPersons = async () => {
    if (picked.size === 0) return;
    setBusy(true); setMsg(null);
    try {
      const { added, skipped } = await addAllowed(supabase, Array.from(picked.keys()).map((pid) => ({
        event_id: event.id, person_id: pid, church_id: null, service_id: null, class_id: null, note: null,
      })));
      onChanged([...allowed, ...added]);
      setPicked(new Map()); setQ('');
      setMsg({ ok: true, text: `أُضيف ${added.length}${skipped ? ` · ${skipped} كان مضافاً` : ''}` });
    } catch (e) {
      setMsg({ ok: false, text: 'تعذر الإضافة — ' + ((e as { message?: string }).message ?? '') });
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { await removeAllowed(supabase, id); onChanged(allowed.filter((a) => a.id !== id)); }
    finally { setBusy(false); }
  };

  const byKind = useMemo(() => {
    const m: Record<AllowedKind, AccessAllowedWithPerson[]> = { church: [], service: [], class: [], person: [] };
    allowed.forEach((a) => m[allowedKind(a)].push(a));
    return m;
  }, [allowed]);

  return (
    <div className="space-y-3">
      {event.allow_all ? (
        <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs font-extrabold text-amber-700">
          هذه البوابة «مفتوحة للجميع» — قائمة المسموح لهم لا تؤثر حالياً. أوقف الخيار من تعديل البوابة لتفعيلها.
        </p>
      ) : (
        <p className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
          المسموح لهم فقط
          <HintBox title="المسموح لهم">من ليس ضمن هذه القائمة يُرفض <b>حتى لو تحققت كل القواعد</b>. أضف أشخاصاً بعينهم أو فصلاً أو خدمة أو كنيسة كاملة — أو أي مزيج.</HintBox>
        </p>
      )}

      {/* current entries */}
      {allowed.length === 0 ? (
        <div className="card py-6 text-center">
          <Users className="mx-auto mb-1 h-8 w-8 text-slate-300" />
          <p className="text-sm font-bold text-slate-500">القائمة فارغة — {event.allow_all ? 'البوابة مفتوحة للجميع' : 'لا أحد مسموح له بعد'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(['church', 'service', 'class', 'person'] as AllowedKind[]).map((k) => {
            const rows = byKind[k];
            if (rows.length === 0) return null;
            const Icon = KIND_ICON[k];
            return (
              <div key={k} id={`access-allowed-${k}`} className="card !p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-slate-600"><Icon className="h-4 w-4" /> {ALLOWED_KIND_LABELS[k]} <span className="text-slate-400">({rows.length})</span></h4>
                <ul className="space-y-1">
                  {rows.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-2 py-1.5">
                      {k === 'person' && a.person && <PersonAvatar name={a.person.name} imageUrl={a.person.image_url} size={30} />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{allowedLabel(a, lookups)}</span>
                        {k === 'person' && a.person && <span className="font-mono text-[10px] text-slate-400" dir="ltr">{a.person.national_id}</span>}
                      </span>
                      {canManage && (
                        <button type="button" onClick={() => remove(a.id)} disabled={busy} aria-label="إزالة" className="rounded-lg bg-red-50 p-1.5 text-red-500 hover:bg-red-100">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* add */}
      {canManage && (
        <div className="card !p-3">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
            {([{ key: 'group' as const, label: 'فصل / خدمة / كنيسة', icon: Layers }, { key: 'persons' as const, label: 'أشخاص', icon: UserPlus }]).map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.key} id={`access-allowed-tab-${t.key}`} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-extrabold ${tab === t.key ? 'bg-white shadow text-primary-700' : 'text-slate-500'}`}>
                  <Icon className="h-4 w-4" /> {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'group' ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <select id="access-allowed-church" className="input-field !px-2 text-xs font-bold" value={churchId} onChange={(e) => { setChurchId(e.target.value); setServiceId(ALL); setClassIds([]); }}>
                  {scope.churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select id="access-allowed-service" className="input-field !px-2 text-xs font-bold" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setClassIds([]); }}>
                  <option value={ALL}>كل الخدمات</option>
                  {visibleServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <MultiClassSelect id="access-allowed-class" value={classIds} onChange={setClassIds} options={visibleClasses} disabled={serviceId === ALL} />
              </div>
              <button id="access-allowed-add-group" type="button" onClick={addGroup} disabled={busy || !churchId} className="btn-primary flex w-full items-center justify-center gap-1.5 !py-2 text-sm">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {serviceId === ALL ? 'إضافة الكنيسة كاملة' : classIds.length === 0 ? 'إضافة الخدمة كاملة' : classIds.length === 1 ? 'إضافة الفصل' : `إضافة ${classIds.length} فصول`}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input id="access-allowed-search" className="input-field pr-9" placeholder="ابحث بالاسم أو الهاتف أو الكود…" value={q} onChange={(e) => setQ(e.target.value)} />
                  {searching && <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
                </div>
                <button type="button" id="access-allowed-scan" onClick={() => setScanOpen((v) => !v)} aria-pressed={scanOpen} className={`rounded-xl px-3 ${scanOpen ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`} title="مسح كود">
                  <ScanLine className="h-4 w-4" />
                </button>
              </div>
              {scanOpen && <QrScanner idPrefix="access-allowed" hint="امسح كود الشخص لإضافته" onCode={onScan} />}
              {picked.size > 0 && (
                <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-primary-50 p-2">
                  {Array.from(picked.values()).map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-extrabold text-primary-800 ring-1 ring-primary-200">
                      {p.name}
                      <button type="button" onClick={() => togglePick(p)} aria-label="إزالة من الاختيار"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <button id="access-allowed-add-persons" type="button" onClick={addPersons} disabled={busy} className="mr-auto flex items-center gap-1 rounded-xl bg-primary-600 px-3 py-1.5 text-xs font-extrabold text-white">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} إضافة {picked.size}
                  </button>
                </div>
              )}
              {q.trim().length >= 2 && (
                <ul className="max-h-64 space-y-1 overflow-y-auto no-scrollbar">
                  {hits.length === 0 && !searching && <li className="py-2 text-center text-xs font-bold text-slate-400">لا نتائج</li>}
                  {hits.map((h) => {
                    const listed = listedPersonIds.has(h.person.id);
                    const on = picked.has(h.person.id);
                    return (
                      <li key={h.person.id}>
                        <button type="button" disabled={listed} onClick={() => togglePick(h.person)}
                          className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-right ${on ? 'bg-primary-50' : 'hover:bg-slate-50'} disabled:opacity-50`}>
                          <PersonAvatar name={h.person.name} imageUrl={h.person.image_url} size={32} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{h.person.name}</span>
                            <span className="flex items-center gap-1 font-mono text-[10px] text-slate-400" dir="ltr"><Hash className="h-3 w-3" />{h.person.national_id}</span>
                          </span>
                          {listed ? <span className="text-[10px] font-extrabold text-emerald-600">مضاف</span>
                            : <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300'}`}>{on && <Check className="h-3.5 w-3.5" />}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {msg && <p className={`mt-2 rounded-xl px-3 py-1.5 text-[11px] font-bold ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
