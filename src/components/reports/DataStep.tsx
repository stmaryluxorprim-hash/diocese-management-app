'use client';
import { MultiClassSelect } from '@/components/MultiClassSelect';
import { inClassesOrWide } from '@/lib/class-multi';

// ---------- Step 1 — اختيار البيانات ----------
// Source cards → scope (church → service → class) → the filters the source
// understands (period · event · cause · exam · gender · status …).

import { useMemo } from 'react';
import { Database, MapPin, SlidersHorizontal, CalendarRange, Loader2, Play } from 'lucide-react';
import type { Church, Service, ClassRoom } from '@/lib/types';
import { ROLE_LABELS, STATUS_LABELS } from '@/lib/types';
import type { ResultExam } from '@/lib/results';
import { REPORT_SOURCES, FILTER_LABELS, type ReportLookups, type FilterKey } from '@/lib/reports/sources';
import type { ReportQuery, ReportSourceKey } from '@/lib/reports/types';
import { reportClassIds } from '@/lib/reports/types';
import { Field, Section } from './ReportBits';

export function DataStep({
  query, onChange, lookups, exams, examsLoading, onRun, running, rowsCount,
}: {
  query: ReportQuery;
  onChange: (patch: Partial<ReportQuery>) => void;
  lookups: ReportLookups;
  exams: ResultExam[];
  examsLoading: boolean;
  onRun: () => void;
  running: boolean;
  rowsCount: number | null;
}) {
  const source = REPORT_SOURCES.find((s) => s.key === query.source) ?? REPORT_SOURCES[0];
  const { scope, filters } = query;
  const classIds = reportClassIds(scope);

  const services = useMemo(() => lookups.services.filter((s) => !scope.church || s.church_id === scope.church), [lookups.services, scope.church]);
  const classes = useMemo(() => lookups.classes.filter((c) => (!scope.church || c.church_id === scope.church) && (!scope.service || c.service_id === scope.service)), [lookups.classes, scope]);
  const events = useMemo(() => lookups.events.filter((e) =>
    (!scope.church || e.church_id === scope.church) &&
    (!scope.service || e.service_id === null || e.service_id === scope.service) &&
    inClassesOrWide(classIds, e.class_id)), [lookups.events, scope, classIds]);
  const causes = useMemo(() => lookups.causes.filter((c) =>
    (!scope.church || c.church_id === scope.church) &&
    (!scope.service || c.service_id === null || c.service_id === scope.service) &&
    inClassesOrWide(classIds, c.class_id)), [lookups.causes, scope, classIds]);
  const visibleExams = useMemo(() => exams.filter((x) =>
    (!scope.church || x.church_id === scope.church) &&
    (!scope.service || x.service_id === null || x.service_id === scope.service) &&
    inClassesOrWide(classIds, x.class_id)), [exams, scope, classIds]);

  const setScope = (patch: Partial<typeof scope>) => {
    const next = { ...scope, ...patch };
    if (patch.church !== undefined) { next.service = ''; next.class = ''; next.classes = []; }
    if (patch.service !== undefined) { next.class = ''; next.classes = []; }
    onChange({ scope: next, filters: { ...filters, event: '', cause: '', exam: filters.exam } });
  };
  const setFilter = <K extends keyof ReportQuery['filters']>(k: K, v: ReportQuery['filters'][K]) => onChange({ filters: { ...filters, [k]: v } });

  const has = (k: FilterKey) => source.filters.includes(k);
  const selectCls = 'input-field !py-2 !px-2.5 text-sm';

  return (
    <div className="space-y-3">
      {/* ---------- source ---------- */}
      <Section title="مصدر البيانات" icon={<Database className="h-4 w-4" />} id="report-sources">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {REPORT_SOURCES.map((s) => {
            const active = s.key === query.source;
            return (
              <button key={s.key} id={`report-source-${s.key}`} type="button" onClick={() => onChange({ source: s.key as ReportSourceKey })}
                className={`rounded-xl border p-2.5 text-start transition active:scale-[0.98] ${active ? 'border-fuchsia-400 bg-fuchsia-50 ring-2 ring-fuchsia-200' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <p className={`text-sm font-extrabold ${active ? 'text-fuchsia-700' : 'text-slate-700'}`}>{s.label}</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] font-bold leading-relaxed text-slate-400">{s.desc}</p>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ---------- scope ---------- */}
      <Section title="النطاق" icon={<MapPin className="h-4 w-4" />} id="report-scope">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="الكنيسة">
            <select id="report-scope-church" className={selectCls} value={scope.church} onChange={(e) => setScope({ church: e.target.value })}>
              <option value="">كل الكنائس</option>
              {lookups.churches.map((c: Church) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="الخدمة">
            <select id="report-scope-service" className={selectCls} value={scope.service} onChange={(e) => setScope({ service: e.target.value })}>
              <option value="">كل الخدمات</option>
              {services.map((s: Service) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="الفصل">
            <MultiClassSelect id="report-scope-class" className="!py-2.5 !px-2.5 !text-sm" value={classIds}
              onChange={(ids) => setScope({ classes: ids, class: ids.length === 1 ? ids[0] : '' })} options={classes} />
          </Field>
        </div>
      </Section>

      {/* ---------- filters ---------- */}
      <Section title="الفلاتر" icon={<SlidersHorizontal className="h-4 w-4" />} id="report-filters">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {has('period') && (
            <div className="sm:col-span-2 rounded-xl bg-slate-50 p-2">
              <p className="mb-1.5 flex items-center gap-1 text-[11px] font-extrabold text-slate-500"><CalendarRange className="h-3.5 w-3.5" /> {FILTER_LABELS.period}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="من">
                  <input id="report-filter-from" type="date" className={selectCls} dir="ltr" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value)} />
                </Field>
                <Field label="إلى">
                  <input id="report-filter-to" type="date" className={selectCls} dir="ltr" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value)} />
                </Field>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[
                  { l: 'اليوم', d: 0 }, { l: '٧ أيام', d: 7 }, { l: '٣٠ يومًا', d: 30 }, { l: '٩٠ يومًا', d: 90 }, { l: 'سنة', d: 365 },
                ].map((p) => (
                  <button key={p.d} type="button" onClick={() => {
                    const to = new Date(); const from = new Date(); from.setDate(from.getDate() - p.d);
                    onChange({ filters: { ...filters, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) } });
                  }} className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-fuchsia-50">{p.l}</button>
                ))}
                <button type="button" onClick={() => onChange({ filters: { ...filters, from: '', to: '' } })} className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-slate-400 ring-1 ring-slate-200">كل الفترة</button>
              </div>
            </div>
          )}
          {has('event') && (
            <Field label={FILTER_LABELS.event}>
              <select id="report-filter-event" className={selectCls} value={filters.event ?? ''} onChange={(e) => setFilter('event', e.target.value)}>
                <option value="">كل المناسبات</option>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
          )}
          {has('cause') && (
            <Field label={FILTER_LABELS.cause}>
              <select id="report-filter-cause" className={selectCls} value={filters.cause ?? ''} onChange={(e) => setFilter('cause', e.target.value)}>
                <option value="">كل الأسباب</option>
                {causes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          {has('exam') && (
            <Field label={FILTER_LABELS.exam} hint={examsLoading ? 'جارٍ تحميل الامتحانات…' : visibleExams.length === 0 ? 'لا امتحانات في هذا النطاق' : undefined}>
              <select id="report-filter-exam" className={selectCls} value={filters.exam ?? ''} onChange={(e) => setFilter('exam', e.target.value)}>
                <option value="">اختر الامتحان…</option>
                {visibleExams.map((x) => <option key={x.id} value={x.id}>{x.name}{x.academic_year ? ` · ${x.academic_year}` : ''}</option>)}
              </select>
            </Field>
          )}
          {has('gender') && (
            <Field label={FILTER_LABELS.gender}>
              <select id="report-filter-gender" className={selectCls} value={filters.gender ?? ''} onChange={(e) => setFilter('gender', e.target.value as '' | 'male' | 'female')}>
                <option value="">الكل</option><option value="male">ذكور</option><option value="female">إناث</option>
              </select>
            </Field>
          )}
          {has('status') && (
            <Field label={FILTER_LABELS.status}>
              <select id="report-filter-status" className={selectCls} value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value as '' | 'active' | 'stopped')}>
                <option value="">الكل</option><option value="active">يعمل</option><option value="stopped">موقوف</option>
              </select>
            </Field>
          )}
          {has('kind') && (
            <Field label={FILTER_LABELS.kind}>
              <select id="report-filter-kind" className={selectCls} value={filters.kind ?? 'child'} onChange={(e) => setFilter('kind', e.target.value as 'child' | 'servant' | 'all')}>
                <option value="child">المخدومون</option><option value="servant">الخدام (تسجيلات)</option><option value="all">الكل</option>
              </select>
            </Field>
          )}
          {has('contactKind') && (
            <Field label={FILTER_LABELS.contactKind}>
              <select id="report-filter-contact" className={selectCls} value={filters.contactKind ?? ''} onChange={(e) => setFilter('contactKind', e.target.value as ReportQuery['filters']['contactKind'])}>
                <option value="">الكل</option><option value="call">اتصال</option><option value="whatsapp">واتساب</option><option value="sms">SMS</option><option value="internal">رسالة داخلية</option>
              </select>
            </Field>
          )}
          {has('pointsSign') && (
            <Field label={FILTER_LABELS.pointsSign}>
              <select id="report-filter-sign" className={selectCls} value={filters.pointsSign ?? ''} onChange={(e) => setFilter('pointsSign', e.target.value as '' | 'add' | 'remove')}>
                <option value="">الكل</option><option value="add">إضافة فقط</option><option value="remove">خصم فقط</option>
              </select>
            </Field>
          )}
          {has('role') && (
            <Field label={FILTER_LABELS.role}>
              <select id="report-filter-role" className={selectCls} value={filters.role ?? ''} onChange={(e) => setFilter('role', e.target.value)}>
                <option value="">كل الأدوار</option>
                {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          )}
          {has('servantStatus') && (
            <Field label={FILTER_LABELS.servantStatus}>
              <select id="report-filter-sstatus" className={selectCls} value={filters.servantStatus ?? ''} onChange={(e) => setFilter('servantStatus', e.target.value)}>
                <option value="">الكل</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          )}
          <Field label="الحد الأقصى للسجلات">
            <select id="report-limit" className={selectCls} value={query.limit} onChange={(e) => onChange({ limit: Number(e.target.value) })}>
              {[200, 1000, 5000, 20000].map((n) => <option key={n} value={n}>{n.toLocaleString('ar-EG')}</option>)}
            </select>
          </Field>
        </div>
      </Section>

      <button id="report-run" type="button" onClick={onRun} disabled={running || (source.key === 'exam_results' && !filters.exam)}
        className="btn-primary flex w-full items-center justify-center gap-2 !from-fuchsia-600 !to-fuchsia-500">
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {running ? 'جارٍ تحميل البيانات…' : rowsCount === null ? 'تحميل البيانات والمتابعة' : `إعادة التحميل (${rowsCount.toLocaleString('ar-EG')} سجل)`}
      </button>
    </div>
  );
}
