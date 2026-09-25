'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader2, Printer, Search, CheckSquare, Square, Users, Inbox, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchAllEnrollments, fetchAllRows, cachedLookup } from '@/lib/queries';
import { useDebouncedRealtime } from '@/lib/realtime';
import type { Church, Service, ClassRoom, EnrollmentWithPerson, CardPrintRequest } from '@/lib/types';
import type { CardDesign, CardPrintSettings, CardTemplate, PaperSize, PaperOrientation } from '@/lib/card-types';
import { PAPER_SIZES, H_ALIGN_LABELS, V_ALIGN_LABELS, BACK_MODE_LABELS } from '@/lib/card-types';
import type { HAlign, VAlign } from '@/lib/card-types';
import { type CardConstantsData, type CardPersonData } from './CardCanvas';
import PrintProfilesBar from './PrintProfilesBar';
import { BackPrintSettings, PagePreview, PrintSheet, type SheetItem } from './PrintSheet';
import { computeLayout, effectiveBackMode, paginate, sheetCount, unitDims } from '@/lib/card-layout';

function Num({
  label, value, onChange, min = 0, max = 500, step = 1,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold text-slate-500">{label} <span className="text-slate-300">(مم)</span></span>
      <input
        type="number"
        className="input-field !py-2 !px-2.5 !text-sm"
        value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        dir="ltr"
      />
    </label>
  );
}

const ALL = 'all';
type PrintSource = 'manual' | 'requested';

const enrollmentToCardData = (e: EnrollmentWithPerson): CardPersonData => ({
  name: e.person.name,
  national_id: e.person.national_id,
  birthdate: e.person.birthdate,
  phone: e.person.phone,
  address: e.person.address,
  image_url: e.person.image_url,
});

interface PrintItem extends SheetItem {
  requestId?: string;
}

// ============================================================
// PRINT TAB
// ============================================================
export default function PrintTab({
  design, settings, onChange, constants, template,
}: {
  design: CardDesign;
  settings: CardPrintSettings;
  onChange: (s: CardPrintSettings) => void;
  constants: CardConstantsData;
  template: CardTemplate;
}) {
  const supabase = createClient();
  const [enrollments, setEnrollments] = useState<EnrollmentWithPerson[]>([]);
  const [churches, setChurches] = useState<Church[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [requests, setRequests] = useState<CardPrintRequest[]>([]);
  const [source, setSource] = useState<PrintSource>('manual');
  const [churchFilter, setChurchFilter] = useState<string>(template.church_id || ALL);
  const [serviceFilter, setServiceFilter] = useState<string>(template.service_id ?? ALL);
  const [classFilter, setClassFilter] = useState<string>(template.class_id ?? ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // enrollment ids
  const [selectedReq, setSelectedReq] = useState<Set<string>>(new Set()); // request ids
  const [deleteAfterPrint, setDeleteAfterPrint] = useState(true);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  // how many enrollments have streamed in so far (big scopes load in pages)
  const [loadedCount, setLoadedCount] = useState(0);
  const [printing, setPrinting] = useState(false);

  const set = (patch: Partial<CardPrintSettings>) => onChange({ ...settings, ...patch });

  // ---------- load everything ----------
  const load = useCallback(async () => {
    setLoadedCount(0);
    const [enr, ch, sv, cl, rq] = await Promise.all([
      // Only the SELECTED scope — ALL of it, paged server-side (no cap):
      // a church-wide print must include every child.
      fetchAllEnrollments(supabase, { church: churchFilter, service: serviceFilter, class: classFilter }, { onProgress: setLoadedCount }),
      cachedLookup<Church>(supabase, 'churches'),
      cachedLookup<Service>(supabase, 'services'),
      cachedLookup<ClassRoom>(supabase, 'classes'),
      // the whole queue too — a bare select() is cut at 1000 by PostgREST
      fetchAllRows<CardPrintRequest>((from, to) =>
        supabase.from('card_print_requests').select('*').order('created_at', { ascending: false }).order('id').range(from, to)
      ).catch(() => [] as CardPrintRequest[]),
    ]);
    setEnrollments(enr);
    setChurches(ch);
    setServices(sv);
    setClasses(cl);
    setRequests(rq);
    setLoading(false);
  }, [supabase, churchFilter, serviceFilter, classFilter]);

  useEffect(() => { load(); }, [load]);

  // realtime: refresh when print requests change (debounced, no overlap)
  useDebouncedRealtime(supabase, 'card-print-requests', [{ table: 'card_print_requests' }], load);

  // ---------- scope filters (church / service / class with "all") ----------
  const inScope = useCallback((x: { church_id: string; service_id: string | null; class_id: string | null }) => {
    if (churchFilter !== ALL && x.church_id !== churchFilter) return false;
    if (serviceFilter !== ALL && x.service_id !== serviceFilter) return false;
    if (classFilter !== ALL && x.class_id !== classFilter) return false;
    return true;
  }, [churchFilter, serviceFilter, classFilter]);

  // per-enrollment constants (church/service/class names) — fallback to template constants
  const constantsFor = useCallback((e: { church_id: string; service_id: string | null; class_id: string | null }): CardConstantsData => {
    const church = churches.find((c) => c.id === e.church_id);
    const service = services.find((s) => s.id === e.service_id);
    const cls = classes.find((c) => c.id === e.class_id);
    return {
      church_name: church?.name ?? constants.church_name,
      service_name: service?.name ?? constants.service_name,
      class_name: cls?.name ?? constants.class_name,
      church_logo_url: church?.logo_url ?? constants.church_logo_url,
      service_logo_url: service?.photo_url ?? constants.service_logo_url ?? null,
      class_logo_url: cls?.photo_url ?? constants.class_logo_url ?? null,
    };
  }, [churches, services, classes, constants]);

  // ---------- sort: church → service → class → name (Arabic alphabetical) ----------
  const compareScope = useCallback((
    a: { church_id: string; service_id: string | null; class_id: string | null; personName: string },
    b: { church_id: string; service_id: string | null; class_id: string | null; personName: string },
  ) => {
    const cn = (id: string | null) => churches.find((c) => c.id === id)?.name ?? '';
    const sn = (id: string | null) => services.find((s) => s.id === id)?.name ?? '';
    const kn = (id: string | null) => classes.find((c) => c.id === id)?.name ?? '';
    return (
      cn(a.church_id).localeCompare(cn(b.church_id), 'ar') ||
      sn(a.service_id).localeCompare(sn(b.service_id), 'ar') ||
      kn(a.class_id).localeCompare(kn(b.class_id), 'ar') ||
      a.personName.localeCompare(b.personName, 'ar')
    );
  }, [churches, services, classes]);

  // enrollments in scope, deduped per person
  const scopedEnrollments = useMemo(() => {
    const map = new Map<string, EnrollmentWithPerson>();
    enrollments.filter(inScope).forEach((e) => { if (!map.has(e.person.id)) map.set(e.person.id, e); });
    return Array.from(map.values()).sort((a, b) => compareScope(
      { church_id: a.church_id, service_id: a.service_id, class_id: a.class_id, personName: a.person.name },
      { church_id: b.church_id, service_id: b.service_id, class_id: b.class_id, personName: b.person.name },
    ));
  }, [enrollments, inScope, compareScope]);

  const filtered = useMemo(() => {
    const s = search.trim();
    if (!s) return scopedEnrollments;
    return scopedEnrollments.filter((e) =>
      e.person.name.includes(s) || e.person.national_id.includes(s) || (e.person.phone ?? '').includes(s));
  }, [scopedEnrollments, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((e) => next.delete(e.id));
      else filtered.forEach((e) => next.add(e.id));
      return next;
    });
  };

  // ---------- requested list ----------
  const enrollmentById = useMemo(() => {
    const m = new Map<string, EnrollmentWithPerson>();
    enrollments.forEach((e) => m.set(e.id, e));
    return m;
  }, [enrollments]);
  // sorted church → service → class → name, same as the manual list
  const scopedRequests = useMemo(() =>
    requests.filter(inScope).sort((a, b) => compareScope(
      { church_id: a.church_id, service_id: a.service_id, class_id: a.class_id, personName: enrollmentById.get(a.enrollment_id)?.person.name ?? '' },
      { church_id: b.church_id, service_id: b.service_id, class_id: b.class_id, personName: enrollmentById.get(b.enrollment_id)?.person.name ?? '' },
    )),
  [requests, inScope, compareScope, enrollmentById]);

  const toggleReq = (id: string) => {
    setSelectedReq((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteRequests = async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await supabase.from('card_print_requests').delete().in('id', ids);
    if (error) { alert('تعذّر حذف الطلبات: ' + error.message); return; }
    setSelectedReq((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    load();
  };
  const deleteOneRequest = (id: string) => deleteRequests([id]);
  const deleteSelectedRequests = () => {
    const ids = Array.from(selectedReq).filter((id) => scopedRequests.some((r) => r.id === id));
    if (ids.length === 0) return;
    if (confirm(`حذف ${ids.length} طلب من قائمة الطباعة؟`)) deleteRequests(ids);
  };
  const deleteAllRequests = () => {
    if (scopedRequests.length === 0) return;
    if (confirm(`حذف كل الطلبات الظاهرة (${scopedRequests.length})؟`)) deleteRequests(scopedRequests.map((r) => r.id));
  };

  // ---------- items to print ----------
  const printItems = useMemo<PrintItem[]>(() => {
    if (source === 'manual') {
      return scopedEnrollments
        .filter((e) => selected.has(e.id))
        .map((e) => ({ key: e.id, person: enrollmentToCardData(e), constants: constantsFor(e), design }));
    }
    // requested: checked requests, or ALL scoped requests when none checked
    const reqs = selectedReq.size > 0 ? scopedRequests.filter((r) => selectedReq.has(r.id)) : scopedRequests;
    const items: PrintItem[] = [];
    reqs.forEach((r) => {
      const e = enrollmentById.get(r.enrollment_id);
      if (!e) return;
      items.push({ key: r.id, person: enrollmentToCardData(e), constants: constantsFor(e), requestId: r.id, design });
    });
    return items;
  }, [source, scopedEnrollments, selected, selectedReq, scopedRequests, enrollmentById, constantsFor, design]);

  const printCount = printItems.length;

  // ---------- layout math (shared with every print tab) ----------
  // one grid cell = the printed unit: front alone, or front + back beside / below
  const backMode = effectiveBackMode(design, settings);
  const unit = unitDims(design, settings);
  const layout = computeLayout(settings, unit.w, unit.h);
  const { paper, cols, rows, perPage } = layout;
  const pages = perPage > 0 ? Math.ceil(Math.max(printCount, 1) / perPage) : 0;
  const sheets = sheetCount(pages, backMode);
  const alignH = settings.alignH ?? 'center';
  const alignV = settings.alignV ?? 'top';

  // preview scale (fit paper into ~330px width; two pages side by side in separate mode)
  const previewScale = backMode === 'separate'
    ? Math.min(160 / paper.w, 260 / paper.h)
    : Math.min(330 / paper.w, 420 / paper.h);

  const doPrint = () => {
    setPrinting(true);
    const printedRequestIds = printItems.map((it) => it.requestId).filter((id): id is string => !!id);
    // give the portal a tick to render QR codes & images before printing
    setTimeout(() => {
      window.print();
      setPrinting(false);
      if (source === 'requested' && deleteAfterPrint && printedRequestIds.length > 0) {
        if (confirm(`تمت الطباعة — حذف ${printedRequestIds.length} طلب من قائمة المطلوب طباعتهم؟`)) {
          deleteRequests(printedRequestIds);
        }
      }
    }, 800);
  };

  // pages of items for print
  const printPages = useMemo(() => paginate(printItems, perPage), [printItems, perPage]);

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- saved print profiles (ملفات الطباعة) — apply / save the settings below ---------- */}
      <PrintProfilesBar
        settings={settings}
        onApply={(s) => onChange(s)}
        card={{ width: design.width, height: design.height }}
        defaultScope={{ church_id: template.church_id, service_id: template.service_id, class_id: template.class_id }}
      />

      {/* ---------- paper settings ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">الورقة</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">مقاس الورق</span>
            <select
              className="input-field !py-2 !px-2.5 !text-sm"
              value={settings.paper}
              onChange={(e) => set({ paper: e.target.value as PaperSize })}
            >
              {Object.entries(PAPER_SIZES).map(([v, p]) => <option key={v} value={v}>{p.label}</option>)}
              <option value="custom">مخصص…</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الاتجاه</span>
            <div className="flex gap-1">
              {(['portrait', 'landscape'] as PaperOrientation[]).map((o) => (
                <button
                  key={o}
                  onClick={() => set({ orientation: o })}
                  className={`flex-1 rounded-xl border py-2.5 text-xs font-extrabold transition ${
                    settings.orientation === o
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  {o === 'portrait' ? '↕ طولي' : '↔ عرضي'}
                </button>
              ))}
            </div>
          </label>
        </div>
        {settings.paper === 'custom' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Num label="عرض الورقة" value={settings.customWidth} min={50} max={2000} onChange={(v) => set({ customWidth: v })} />
            <Num label="طول الورقة" value={settings.customHeight} min={50} max={2000} onChange={(v) => set({ customHeight: v })} />
          </div>
        )}
      </section>

      {/* ---------- margins & gaps ---------- */}
      <section className="card">
        <h3 className="mb-2 text-sm font-extrabold text-slate-600">الهوامش والمسافات</h3>
        <div className="grid grid-cols-4 gap-2">
          <Num label="هامش أعلى" value={settings.marginTop} max={100} onChange={(v) => set({ marginTop: v })} />
          <Num label="هامش أسفل" value={settings.marginBottom} max={100} onChange={(v) => set({ marginBottom: v })} />
          <Num label="هامش يمين" value={settings.marginRight} max={100} onChange={(v) => set({ marginRight: v })} />
          <Num label="هامش يسار" value={settings.marginLeft} max={100} onChange={(v) => set({ marginLeft: v })} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Num label="مسافة أفقية بين الكروت" value={settings.gapX} max={100} onChange={(v) => set({ gapX: v })} />
          <Num label="مسافة رأسية بين الكروت" value={settings.gapY} max={100} onChange={(v) => set({ gapY: v })} />
        </div>
        {/* grid alignment inside printable area */}
        <div className="mt-3 border-t border-indigo-50 pt-3">
          <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">محاذاة الكروت داخل الصفحة</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">أفقياً</span>
              <div className="flex gap-1">
                {(['right', 'center', 'left'] as HAlign[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => set({ alignH: a })}
                    className={`flex-1 rounded-xl border py-2 text-[11px] font-extrabold transition ${
                      alignH === a
                        ? 'border-primary-300 bg-primary-50 text-primary-700'
                        : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {H_ALIGN_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="mb-0.5 block text-[11px] font-bold text-slate-500">رأسياً</span>
              <div className="flex gap-1">
                {(['top', 'center', 'bottom'] as VAlign[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => set({ alignV: a })}
                    className={`flex-1 rounded-xl border py-2 text-[11px] font-extrabold transition ${
                      alignV === a
                        ? 'border-primary-300 bg-primary-50 text-primary-700'
                        : 'border-slate-200 text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {V_ALIGN_LABELS[a]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs font-extrabold text-slate-600">
          <input
            type="checkbox"
            checked={settings.cutMarks}
            onChange={(e) => set({ cutMarks: e.target.checked })}
            className="h-4 w-4 accent-primary-600"
          />
          إظهار خطوط القص (إطار رفيع حول كل كارت)
        </label>
        {/* page center lines */}
        <div className="mt-3 rounded-xl bg-pink-50/60 p-3">
          <p className="mb-1.5 text-[11px] font-extrabold text-slate-500">خطوط منتصف الصفحة (تظهر في المعاينة والطباعة)</p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs font-extrabold text-slate-600">
              <input
                type="checkbox"
                checked={settings.centerLineV ?? false}
                onChange={(e) => set({ centerLineV: e.target.checked })}
                className="h-4 w-4 accent-pink-500"
              />
              خط منتصف رأسي ↕
            </label>
            <label className="flex items-center gap-2 text-xs font-extrabold text-slate-600">
              <input
                type="checkbox"
                checked={settings.centerLineH ?? false}
                onChange={(e) => set({ centerLineH: e.target.checked })}
                className="h-4 w-4 accent-pink-500"
              />
              خط منتصف أفقي ↔
            </label>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-indigo-50/60 p-3 text-xs font-bold text-slate-600">
          التخطيط: <span className="text-primary-700">{cols} × {rows}</span> = {perPage} كارت في الصفحة
          {backMode !== 'none' && <> · <span className="text-violet-700">{BACK_MODE_LABELS[backMode]}</span></>}
          {printCount > 0 && perPage > 0 && (
            <> · {printCount} كارت ← <span className="text-primary-700">{sheets} صفحة</span>{backMode === 'separate' && <span className="text-slate-400"> ({pages} وجه + {pages} ظهر)</span>}</>
          )}
          {perPage === 0 && <span className="text-red-500"> — الكارت أكبر من مساحة الورقة!</span>}
        </div>
      </section>

      {/* ---------- back side + page flip ---------- */}
      <BackPrintSettings settings={settings} onChange={set} design={design} />

      {/* ---------- page preview (frozen at top while scrolling) ---------- */}
      <PagePreview
        items={printItems.slice(0, perPage)}
        layout={layout}
        settings={settings}
        previewScale={previewScale}
        placeholderDesign={design}
        showBackPage={backMode === 'separate'}
        title={<>معاينة الصفحة الأولى — {cols}×{rows} · {H_ALIGN_LABELS[alignH]} / {V_ALIGN_LABELS[alignV]}{backMode !== 'none' && <> · {BACK_MODE_LABELS[backMode]}</>}</>}
      />

      {/* ---------- who to print ---------- */}
      <section className="card">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
          <Users className="h-4 w-4 text-primary-500" />
          من تريد طباعته؟
        </h3>
        {/* scope selectors */}
        <div className="mb-3 grid grid-cols-3 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الكنيسة</span>
            <select
              className="input-field !py-2 !px-2 !text-xs"
              value={churchFilter}
              onChange={(e) => {
                setChurchFilter(e.target.value);
                setServiceFilter(ALL);
                setClassFilter(ALL);
              }}
            >
              <option value={ALL}>كل الكنائس</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الخدمة</span>
            <select
              className="input-field !py-2 !px-2 !text-xs"
              value={serviceFilter}
              onChange={(e) => {
                setServiceFilter(e.target.value);
                setClassFilter(ALL);
              }}
            >
              <option value={ALL}>كل الخدمات</option>
              {services
                .filter((s) => churchFilter === ALL || s.church_id === churchFilter)
                .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-bold text-slate-500">الفصل</span>
            <select
              className="input-field !py-2 !px-2 !text-xs"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value={ALL}>كل الفصول</option>
              {classes
                .filter((c) =>
                  (churchFilter === ALL || c.church_id === churchFilter) &&
                  (serviceFilter === ALL || c.service_id === serviceFilter))
                .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        {/* source toggle */}
        <div className="flex gap-1">
          <button
            onClick={() => setSource('manual')}
            className={`flex-1 rounded-xl border py-2.5 text-xs font-extrabold transition ${
              source === 'manual'
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-slate-200 text-slate-400 hover:bg-slate-50'
            }`}
          >
            اختيار يدوي
          </button>
          <button
            onClick={() => setSource('requested')}
            className={`flex-1 rounded-xl border py-2.5 text-xs font-extrabold transition ${
              source === 'requested'
                ? 'border-violet-300 bg-violet-50 text-violet-700'
                : 'border-slate-200 text-slate-400 hover:bg-slate-50'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Inbox className="h-4 w-4" />
              المطلوب طباعتهم
              <span className={`badge ${source === 'requested' ? 'bg-violet-200 text-violet-800' : 'bg-slate-100 text-slate-500'}`}>
                {scopedRequests.length}
              </span>
            </span>
          </button>
        </div>
      </section>

      {/* ---------- manual person picker ---------- */}
      {source === 'manual' && (
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
              <Users className="h-4 w-4 text-primary-500" />
              المخدومون
              <span className="badge bg-primary-100 text-primary-700">{selected.size} / {scopedEnrollments.length}</span>
            </h3>
            <button onClick={toggleAll} className="flex items-center gap-1 text-xs font-extrabold text-primary-600 hover:underline">
              {allFilteredSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {allFilteredSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
            </button>
          </div>
          <div className="relative mb-2">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input
              className="input-field !py-2 !pr-9 !text-sm"
              placeholder="بحث بالاسم / الرقم القومي / الهاتف"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-xs font-bold text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
              {loadedCount > 0 && <span className="tabular-nums">تم تحميل {loadedCount.toLocaleString('ar-EG')}…</span>}
            </div>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => toggle(e.id)}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                      selected.has(e.id)
                        ? 'border-primary-300 bg-primary-50 text-primary-700'
                        : 'border-slate-100 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {selected.has(e.id) ? <CheckSquare className="h-4 w-4 shrink-0 text-primary-600" /> : <Square className="h-4 w-4 shrink-0 text-slate-300" />}
                    <span className="min-w-0 flex-1 truncate text-right">{e.person.name}</span>
                    <span className="text-[10px] font-normal text-slate-300" dir="ltr">{e.person.national_id}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="py-6 text-center text-xs font-bold text-slate-300">لا نتائج</li>
              )}
            </ul>
          )}
        </section>
      )}

      {/* ---------- requested list ---------- */}
      {source === 'requested' && (
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-600">
              <Inbox className="h-4 w-4 text-violet-500" />
              المطلوب طباعتهم
              <span className="badge bg-violet-100 text-violet-700">{selectedReq.size > 0 ? `${selectedReq.size} / ` : ''}{scopedRequests.length}</span>
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={deleteSelectedRequests}
                disabled={selectedReq.size === 0}
                className="flex items-center gap-1 text-xs font-extrabold text-red-500 hover:underline disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" /> حذف المحدد
              </button>
              <button
                onClick={deleteAllRequests}
                disabled={scopedRequests.length === 0}
                className="flex items-center gap-1 text-xs font-extrabold text-red-500 hover:underline disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" /> حذف الكل
              </button>
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {scopedRequests.map((r) => {
                const e = enrollmentById.get(r.enrollment_id);
                const cls = classes.find((c) => c.id === r.class_id);
                const checked = selectedReq.has(r.id);
                return (
                  <li key={r.id} className="flex items-center gap-1">
                    <button
                      onClick={() => toggleReq(r.id)}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                        checked
                          ? 'border-violet-300 bg-violet-50 text-violet-700'
                          : 'border-slate-100 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {checked ? <CheckSquare className="h-4 w-4 shrink-0 text-violet-600" /> : <Square className="h-4 w-4 shrink-0 text-slate-300" />}
                      <span className="min-w-0 flex-1 truncate text-right">{e?.person.name ?? '— غير موجود —'}</span>
                      {cls && <span className="badge shrink-0 bg-slate-100 text-slate-500">{cls.name}</span>}
                    </button>
                    <button
                      onClick={() => deleteOneRequest(r.id)}
                      className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      title="حذف الطلب"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
              {scopedRequests.length === 0 && (
                <li className="py-6 text-center text-xs font-bold text-slate-300">
                  لا توجد طلبات طباعة — أرسلها من صفحة المخدومين (وظيفة «طباعة كارت»)
                </li>
              )}
            </ul>
          )}
          <label className="mt-3 flex items-center gap-2 text-xs font-extrabold text-slate-600">
            <input
              type="checkbox"
              checked={deleteAfterPrint}
              onChange={(e) => setDeleteAfterPrint(e.target.checked)}
              className="h-4 w-4 accent-violet-600"
            />
            حذف الطلبات من القائمة بعد الطباعة (بعد تأكيد)
          </label>
          <p className="mt-1.5 text-[11px] font-bold text-slate-400">
            بدون تحديد: تُطبع كل الطلبات الظاهرة. حدِّد طلبات معينة لطباعتها فقط.
          </p>
        </section>
      )}

      {/* ---------- print button ---------- */}
      <button
        onClick={doPrint}
        disabled={printCount === 0 || perPage === 0 || printing}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
        طباعة {printCount > 0 ? `(${printCount} كارت — ${sheets} صفحة)` : ''}
      </button>
      <p className="pb-2 text-center text-[11px] font-bold text-slate-400">
        في نافذة الطباعة: اختر نفس مقاس الورق ({settings.paper === 'custom' ? 'مخصص' : settings.paper})
        واضبط الهوامش على «بلا / None» والمقياس على 100%.
        {backMode === 'separate' && ' للطباعة على الوجهين: فعّل «طباعة على الوجهين / Duplex» أو اطبع الصفحات الفردية ثم أعد الورق واطبع الزوجية.'}
      </p>

      {/* ---------- hidden print sheet (portal to body) ---------- */}
      <PrintSheet
        pages={printPages}
        layout={layout}
        settings={settings}
        backPages={backMode === 'separate'}
      />
    </div>
  );
}
